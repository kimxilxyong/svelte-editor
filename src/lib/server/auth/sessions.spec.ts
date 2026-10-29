import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import {
	SESSION_LIFETIME_MS,
	clearSessionCookie,
	createSession,
	invalidateSession,
	invalidateUserSessions,
	listUserSessions,
	purgeExpired,
	sessionCookieName,
	setSessionCookie,
	validateSessionToken
} from './sessions.js';

let db: SqlClient;

async function insertUser(id: string, patch: { role?: string; disabled?: number } = {}) {
	const now = new Date().toISOString();
	await db.run(
		`INSERT INTO users (id, email, name, role, disabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[id, `${id}@example.com`, id, patch.role ?? 'user', patch.disabled ?? 0, now, now]
	);
}

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
	await insertUser('u1');
});

describe('sessions', () => {
	it('stores only the hash of the token', async () => {
		const { token } = await createSession(db, 'u1', { ip: '1.2.3.4', userAgent: 'UA' });
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const rows = await db.all<{ id: string; ip: string }>('SELECT id, ip FROM sessions');
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[0].id).not.toContain(token);
		expect(rows[0].ip).toBe('1.2.3.4');
	});

	it('validates a token and returns the user', async () => {
		const { token } = await createSession(db, 'u1');
		const session = await validateSessionToken(db, token);
		expect(session?.user).toEqual({ id: 'u1', email: 'u1@example.com', name: 'u1', role: 'user' });
		expect(session?.renewed).toBeUndefined();
	});

	it('rejects unknown and malformed tokens', async () => {
		expect(await validateSessionToken(db, 'x'.repeat(43))).toBeNull();
		expect(await validateSessionToken(db, '')).toBeNull();
		expect(await validateSessionToken(db, 'x'.repeat(500))).toBeNull();
	});

	it('rejects and deletes expired sessions', async () => {
		const { token } = await createSession(db, 'u1');
		const later = new Date(Date.now() + SESSION_LIFETIME_MS + 1000);
		expect(await validateSessionToken(db, token, later)).toBeNull();
		expect(await db.all('SELECT id FROM sessions')).toHaveLength(0);
	});

	it('renews a session that is close to expiry (sliding window)', async () => {
		const { token } = await createSession(db, 'u1');
		const later = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
		const session = await validateSessionToken(db, token, later);
		expect(session?.renewed).toBeDefined();
		expect(session!.expiresAt.getTime()).toBe(later.getTime() + SESSION_LIFETIME_MS);
		const row = await db.get<{ expires_at: string }>('SELECT expires_at FROM sessions');
		expect(row?.expires_at).toBe(session!.expiresAt.toISOString());
	});

	it('rejects sessions of disabled users and purges all their sessions', async () => {
		const a = await createSession(db, 'u1');
		await createSession(db, 'u1');
		await db.run('UPDATE users SET disabled = 1 WHERE id = ?', ['u1']);
		expect(await validateSessionToken(db, a.token)).toBeNull();
		expect(await db.all('SELECT id FROM sessions')).toHaveLength(0);
	});

	it('fails closed on a tampered role', async () => {
		const { token } = await createSession(db, 'u1');
		await db.run(`UPDATE users SET role = 'root'`);
		expect(await validateSessionToken(db, token)).toBeNull();
	});

	it('invalidates one session or all but one', async () => {
		const a = await createSession(db, 'u1');
		const b = await createSession(db, 'u1');
		const c = await createSession(db, 'u1');
		await invalidateSession(db, a.token);
		expect(await validateSessionToken(db, a.token)).toBeNull();
		const keep = (await validateSessionToken(db, b.token))!.sessionId;
		await invalidateUserSessions(db, 'u1', keep);
		expect(await validateSessionToken(db, c.token)).toBeNull();
		expect(await validateSessionToken(db, b.token)).not.toBeNull();
		await invalidateUserSessions(db, 'u1');
		expect(await listUserSessions(db, 'u1')).toHaveLength(0);
	});

	it('lists unexpired sessions and purges expired ones', async () => {
		await createSession(db, 'u1', { userAgent: 'one' });
		await db.run(
			`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('old', 'u1', ?, ?)`,
			['2000-01-01T00:00:00.000Z', '2000-02-01T00:00:00.000Z']
		);
		expect(await listUserSessions(db, 'u1')).toHaveLength(1);
		expect(await purgeExpired(db)).toBe(1);
		expect(await db.all('SELECT id FROM sessions')).toHaveLength(1);
	});
});

describe('session cookie helpers', () => {
	it('sets an HttpOnly, SameSite=Lax cookie with the secure flag as given', () => {
		const cookies = { set: vi.fn(), delete: vi.fn() };
		const expiresAt = new Date(Date.now() + 3600_000);
		setSessionCookie(cookies as never, 'tok', expiresAt, true);
		expect(cookies.set).toHaveBeenCalledWith(
			sessionCookieName,
			'tok',
			expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: true })
		);
		const options = cookies.set.mock.calls[0][2];
		expect(options.maxAge).toBeGreaterThan(3590);
		clearSessionCookie(cookies as never);
		expect(cookies.delete).toHaveBeenCalledWith(sessionCookieName, { path: '/' });
	});
});
