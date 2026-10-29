import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import { listAudit } from './audit.js';
import { AuthError } from './errors.js';
import { createRateLimiter } from './rate-limit.js';
import { createSession, validateSessionToken } from './sessions.js';
import {
	addIdentity,
	countActiveAdmins,
	countUsers,
	createUser,
	deleteUser,
	findUserByIdentity,
	getUserByEmail,
	getUserById,
	listUsers,
	recordLogin,
	removeIdentity,
	setUserPassword,
	updateUser,
	verifyCredentials
} from './users.js';

const PASSWORD = 'correct horse battery';
const WALLET = '0xAbCdEf0123456789aBcDeF0123456789abcDEF01';
let db: SqlClient;

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

async function code(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(AuthError);
		return (error as AuthError).code;
	}
	return undefined;
}

const admin = (email = 'admin@example.com') =>
	createUser(db, { email, name: 'Admin', password: PASSWORD, role: 'admin' });
const user = (email = 'user@example.com', role: 'user' | 'guest' = 'user') =>
	createUser(db, { email, name: 'Regular', password: PASSWORD, role });

describe('createUser', () => {
	it('creates a password user, lower-casing the email and hiding the hash', async () => {
		const created = await createUser(db, {
			email: ' Ada@Example.com ',
			name: ' Ada  L ',
			password: PASSWORD,
			role: 'user'
		});
		expect(created).toMatchObject({
			email: 'ada@example.com',
			name: 'Ada L',
			role: 'user',
			disabled: false,
			hasPassword: true,
			emailVerified: false,
			identities: []
		});
		expect(JSON.stringify(created)).not.toContain('argon2');
		const stored = await db.get<{ password_hash: string }>('SELECT password_hash FROM users');
		expect(stored?.password_hash).toMatch(/^\$argon2id\$/);
	});

	it('validates input', async () => {
		expect(
			await code(createUser(db, { email: 'bad', name: 'x', password: PASSWORD, role: 'user' }))
		).toBe('invalid_input');
		expect(
			await code(createUser(db, { email: 'a@b.co', name: ' ', password: PASSWORD, role: 'user' }))
		).toBe('invalid_input');
		expect(
			await code(
				createUser(db, { email: 'a@b.co', name: 'x', password: PASSWORD, role: 'root' as never })
			)
		).toBe('invalid_input');
		expect(
			await code(createUser(db, { email: 'a@b.co', name: 'x', password: 'short', role: 'user' }))
		).toBe('weak_password');
		expect(await code(createUser(db, { name: 'x', role: 'user' }))).toBe('invalid_input');
		expect(await code(createUser(db, { name: 'x', password: PASSWORD, role: 'user' }))).toBe(
			'invalid_input'
		);
		expect(await countUsers(db)).toBe(0);
	});

	it('rejects duplicate emails case-insensitively', async () => {
		await user('dup@example.com');
		expect(await code(user('DUP@example.com'))).toBe('email_taken');
	});

	it('creates identity-only users (wallet) without email', async () => {
		const created = await createUser(db, {
			name: 'Wallet',
			role: 'guest',
			identity: { provider: 'wallet', providerUserId: WALLET }
		});
		expect(created.email).toBeNull();
		expect(created.hasPassword).toBe(false);
		expect(created.identities[0]).toMatchObject({ provider: 'wallet', label: '0xabcd…ef01' });
		expect(
			(await findUserByIdentity(db, 'wallet', WALLET.toUpperCase().replace('0X', '0x')))?.id
		).toBe(created.id);
	});

	it('rejects an identity that is already linked and rolls the user back', async () => {
		const identity = { provider: 'github', providerUserId: '42', label: 'octo' } as const;
		await createUser(db, { name: 'A', role: 'guest', identity });
		expect(await code(createUser(db, { name: 'B', role: 'guest', identity }))).toBe(
			'identity_taken'
		);
		expect(await countUsers(db)).toBe(1);
	});

	it('rejects malformed wallet addresses', async () => {
		expect(
			await code(
				createUser(db, {
					name: 'W',
					role: 'guest',
					identity: { provider: 'wallet', providerUserId: '0x1' }
				})
			)
		).toBe('invalid_input');
	});
});

describe('lookups and listing', () => {
	it('finds users by id, email and identity', async () => {
		const u = await createUser(db, {
			email: 'g@example.com',
			name: 'G',
			role: 'user',
			emailVerified: true,
			identity: { provider: 'github', providerUserId: '7', label: 'gh' }
		});
		expect((await getUserById(db, u.id))?.emailVerified).toBe(true);
		expect((await getUserByEmail(db, ' G@Example.com '))?.id).toBe(u.id);
		expect(await getUserByEmail(db, 'nope')).toBeNull();
		expect((await findUserByIdentity(db, 'github', '7'))?.id).toBe(u.id);
		expect(await findUserByIdentity(db, 'github', '8')).toBeNull();
		expect(await getUserById(db, 'missing')).toBeNull();
	});

	it('lists with search, role/status filters and paging; escapes LIKE wildcards', async () => {
		await admin();
		const a = await user('anna@example.com');
		await user('bob@example.com', 'guest');
		await user('100%_real@example.com');
		await updateUser(db, a.id, { disabled: true }, a.id);

		expect((await listUsers(db)).total).toBe(4);
		expect((await listUsers(db, { search: 'ANNA' })).users.map((x) => x.email)).toEqual([
			'anna@example.com'
		]);
		expect((await listUsers(db, { search: '100%_' })).total).toBe(1);
		expect((await listUsers(db, { search: '%' })).total).toBe(1);
		expect((await listUsers(db, { role: 'guest' })).total).toBe(1);
		expect((await listUsers(db, { status: 'disabled' })).users[0].id).toBe(a.id);
		expect((await listUsers(db, { status: 'active' })).total).toBe(3);
		const page = await listUsers(db, { limit: 2, offset: 2 });
		expect(page.users).toHaveLength(2);
		expect(page.total).toBe(4);
	});
});

describe('updateUser', () => {
	it('changes name, email (unverified again), role and records an audit entry', async () => {
		const a = await admin();
		const u = await createUser(db, {
			email: 'u@example.com',
			name: 'U',
			password: PASSWORD,
			role: 'guest',
			emailVerified: true
		});
		const updated = await updateUser(
			db,
			u.id,
			{ name: 'New', email: 'new@example.com', role: 'poweruser' },
			a.id
		);
		expect(updated).toMatchObject({
			name: 'New',
			email: 'new@example.com',
			role: 'poweruser',
			emailVerified: false
		});
		const entry = (await listAudit(db))[0];
		expect(entry).toMatchObject({ action: 'user_update', actorId: a.id });
		expect(entry.detail).toContain('role guest→poweruser');
	});

	it('rejects invalid input, taken emails and unknown users', async () => {
		const a = await admin();
		const u = await user();
		expect(await code(updateUser(db, u.id, { email: 'bad' }, a.id))).toBe('invalid_input');
		expect(await code(updateUser(db, u.id, { name: '' }, a.id))).toBe('invalid_input');
		expect(await code(updateUser(db, u.id, { role: 'root' as never }, a.id))).toBe('invalid_input');
		expect(await code(updateUser(db, u.id, { email: 'admin@example.com' }, a.id))).toBe(
			'email_taken'
		);
		expect(await code(updateUser(db, 'missing', { name: 'x' }, a.id))).toBe('not_found');
	});

	it('protects the last active admin from demotion and disabling', async () => {
		const a = await admin();
		expect(await code(updateUser(db, a.id, { role: 'user' }, a.id))).toBe('last_admin');
		expect(await code(updateUser(db, a.id, { disabled: true }, a.id))).toBe('last_admin');
		expect((await getUserById(db, a.id))?.role).toBe('admin');
	});

	it('allows demoting an admin when another active admin exists, but not a disabled one counting', async () => {
		const a1 = await admin('a1@example.com');
		const a2 = await admin('a2@example.com');
		await updateUser(db, a2.id, { disabled: true }, a1.id);
		expect(await countActiveAdmins(db)).toBe(1);
		expect(await code(updateUser(db, a1.id, { role: 'user' }, a1.id))).toBe('last_admin');
		await updateUser(db, a2.id, { disabled: false }, a1.id);
		expect((await updateUser(db, a1.id, { role: 'user' }, a2.id)).role).toBe('user');
		expect(await countActiveAdmins(db)).toBe(1);
	});

	it('revokes all sessions when a user is disabled', async () => {
		const a = await admin();
		const u = await user();
		const { token } = await createSession(db, u.id);
		await updateUser(db, u.id, { disabled: true }, a.id);
		expect(await validateSessionToken(db, token)).toBeNull();
	});

	it('keeps sessions on a role change (role is read live)', async () => {
		const a = await admin();
		const u = await user();
		const { token } = await createSession(db, u.id);
		await updateUser(db, u.id, { role: 'poweruser' }, a.id);
		expect((await validateSessionToken(db, token))?.user.role).toBe('poweruser');
	});
});

describe('setUserPassword', () => {
	it('replaces the password and revokes sessions by default', async () => {
		const u = await user();
		const { token } = await createSession(db, u.id);
		await setUserPassword(db, u.id, 'another long passphrase');
		expect(await validateSessionToken(db, token)).toBeNull();
		const limiter = createRateLimiter({ max: 5, windowMs: 1000 });
		const ctx = { ip: '1.1.1.1', limiter, ipLimiter: limiter };
		await expect(
			verifyCredentials(db, 'user@example.com', 'another long passphrase', ctx)
		).resolves.toMatchObject({ id: u.id });
		expect(await code(verifyCredentials(db, 'user@example.com', PASSWORD, ctx))).toBe(
			'invalid_credentials'
		);
	});

	it('can keep the current session', async () => {
		const u = await user();
		const keep = await createSession(db, u.id);
		const other = await createSession(db, u.id);
		const keepId = (await validateSessionToken(db, keep.token))!.sessionId;
		await setUserPassword(db, u.id, 'another long passphrase', { exceptSessionId: keepId });
		expect(await validateSessionToken(db, keep.token)).not.toBeNull();
		expect(await validateSessionToken(db, other.token)).toBeNull();
	});

	it('enforces the password policy and existence', async () => {
		const u = await user();
		expect(await code(setUserPassword(db, u.id, 'short'))).toBe('weak_password');
		expect(await code(setUserPassword(db, u.id, 'user@example.com'))).toBe('weak_password');
		expect(await code(setUserPassword(db, 'missing', PASSWORD))).toBe('not_found');
	});

	it('lets a password-less (OAuth) user add a first password', async () => {
		const u = await createUser(db, {
			email: 'o@example.com',
			name: 'O',
			role: 'user',
			identity: { provider: 'google', providerUserId: 'g1' }
		});
		expect(u.hasPassword).toBe(false);
		await setUserPassword(db, u.id, PASSWORD);
		expect((await getUserById(db, u.id))?.hasPassword).toBe(true);
	});
});

describe('verifyCredentials', () => {
	const fresh = () => {
		const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
		const ipLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });
		return { ip: '9.9.9.9', limiter, ipLimiter };
	};

	it('accepts the right credentials with any email casing', async () => {
		const u = await user();
		expect((await verifyCredentials(db, 'USER@example.com', PASSWORD, fresh())).id).toBe(u.id);
	});

	it('gives the same generic error for unknown email, wrong password and no-password accounts', async () => {
		await user();
		await createUser(db, {
			email: 'oauth@example.com',
			name: 'O',
			role: 'user',
			identity: { provider: 'github', providerUserId: '1' }
		});
		const messages = new Set<string>();
		for (const [email, pw] of [
			['nobody@example.com', PASSWORD],
			['user@example.com', 'wrong password here'],
			['oauth@example.com', PASSWORD],
			['not an email', PASSWORD]
		]) {
			try {
				await verifyCredentials(db, email, pw, fresh());
			} catch (error) {
				expect((error as AuthError).code).toBe('invalid_credentials');
				messages.add((error as AuthError).message);
			}
		}
		expect([...messages]).toEqual(['Invalid email or password']);
	});

	it('blocks after repeated failures, even with the right password, and audits failures', async () => {
		await user();
		const ctx = fresh();
		for (let i = 0; i < 3; i++) {
			expect(
				await code(verifyCredentials(db, 'user@example.com', 'wrong password here', ctx))
			).toBe('invalid_credentials');
		}
		expect(await code(verifyCredentials(db, 'user@example.com', PASSWORD, ctx))).toBe(
			'rate_limited'
		);
		expect((await listAudit(db)).filter((e) => e.action === 'login_failed')).toHaveLength(3);
	});

	it('applies the per-IP limit across different emails', async () => {
		await user();
		const ctx = fresh();
		for (let i = 0; i < 5; i++) {
			await code(verifyCredentials(db, `x${i}@example.com`, 'wrong password here', ctx));
		}
		expect(await code(verifyCredentials(db, 'user@example.com', PASSWORD, ctx))).toBe(
			'rate_limited'
		);
	});

	it('resets the per-email counter after a success', async () => {
		await user();
		const ctx = fresh();
		await code(verifyCredentials(db, 'user@example.com', 'wrong password here', ctx));
		await code(verifyCredentials(db, 'user@example.com', 'wrong password here', ctx));
		await verifyCredentials(db, 'user@example.com', PASSWORD, ctx);
		expect(ctx.limiter.check('9.9.9.9|user@example.com').allowed).toBe(true);
		await code(verifyCredentials(db, 'user@example.com', 'wrong password here', ctx));
		expect(ctx.limiter.check('9.9.9.9|user@example.com').allowed).toBe(true);
	});

	it('refuses disabled accounts only after the password was right', async () => {
		const a = await admin();
		const u = await user();
		await updateUser(db, u.id, { disabled: true }, a.id);
		expect(await code(verifyCredentials(db, 'user@example.com', PASSWORD, fresh()))).toBe(
			'account_disabled'
		);
		expect(
			await code(verifyCredentials(db, 'user@example.com', 'wrong password here', fresh()))
		).toBe('invalid_credentials');
	});
});

describe('deleteUser', () => {
	it('deletes the user with identities and sessions and audits it', async () => {
		const a = await admin();
		const u = await createUser(db, {
			email: 'd@example.com',
			name: 'D',
			password: PASSWORD,
			role: 'user',
			identity: { provider: 'github', providerUserId: '5' }
		});
		await createSession(db, u.id);
		await deleteUser(db, u.id, a.id);
		expect(await getUserById(db, u.id)).toBeNull();
		expect(await db.all('SELECT id FROM user_identities')).toHaveLength(0);
		expect(await db.all('SELECT id FROM sessions')).toHaveLength(0);
		expect((await listAudit(db))[0]).toMatchObject({
			action: 'user_delete',
			actorId: a.id,
			target: 'd@example.com'
		});
	});

	it('refuses self deletion and unknown users', async () => {
		const a = await admin();
		await admin('second@example.com');
		expect(await code(deleteUser(db, a.id, a.id))).toBe('forbidden');
		expect(await code(deleteUser(db, 'missing', a.id))).toBe('not_found');
	});

	it('refuses to delete the last active admin', async () => {
		const a = await admin();
		const u = await user();
		expect(await code(deleteUser(db, a.id, u.id))).toBe('last_admin');
		expect(await getUserById(db, a.id)).not.toBeNull();
	});

	it('may delete an admin when another active admin remains, and disabled admins freely', async () => {
		const a1 = await admin('a1@example.com');
		const a2 = await admin('a2@example.com');
		await deleteUser(db, a2.id, a1.id);
		const a3 = await admin('a3@example.com');
		await updateUser(db, a3.id, { disabled: true }, a1.id);
		await deleteUser(db, a3.id, a1.id);
		expect(await countUsers(db)).toBe(1);
	});
});

describe('identities', () => {
	it('adds, rejects duplicates across users, and removes identities', async () => {
		const u = await user();
		const other = await user('other@example.com');
		const identity = await addIdentity(db, u.id, {
			provider: 'github',
			providerUserId: '1',
			label: 'octo'
		});
		expect((await getUserById(db, u.id))?.identities).toEqual([identity]);
		expect(await code(addIdentity(db, other.id, { provider: 'github', providerUserId: '1' }))).toBe(
			'identity_taken'
		);
		expect(
			await code(addIdentity(db, 'missing', { provider: 'github', providerUserId: '2' }))
		).toBe('not_found');
		expect(
			await code(addIdentity(db, u.id, { provider: 'twitter' as never, providerUserId: '2' }))
		).toBe('invalid_input');
		await removeIdentity(db, u.id, identity.id);
		expect((await getUserById(db, u.id))?.identities).toEqual([]);
		const actions = (await listAudit(db)).map((e) => e.action);
		expect(actions).toContain('identity_link');
		expect(actions).toContain('identity_unlink');
	});

	it("refuses to remove the user's last sign-in method", async () => {
		const o = await createUser(db, {
			name: 'O',
			role: 'user',
			identity: { provider: 'github', providerUserId: '1' }
		});
		expect(await code(removeIdentity(db, o.id, o.identities[0].id))).toBe('last_sign_in_method');
	});

	it('allows removing an identity when a password remains, or another identity exists', async () => {
		const u = await user();
		const i1 = await addIdentity(db, u.id, { provider: 'github', providerUserId: '1' });
		await removeIdentity(db, u.id, i1.id);

		const w = await createUser(db, {
			name: 'W',
			role: 'user',
			identity: { provider: 'github', providerUserId: '2' }
		});
		const second = await addIdentity(db, w.id, { provider: 'google', providerUserId: 'g' });
		await removeIdentity(db, w.id, second.id);
		expect((await getUserById(db, w.id))?.identities).toHaveLength(1);
	});

	it("cannot remove someone else's identity", async () => {
		const u = await user();
		const other = await user('other@example.com');
		const identity = await addIdentity(db, other.id, { provider: 'github', providerUserId: '1' });
		expect(await code(removeIdentity(db, u.id, identity.id))).toBe('not_found');
	});
});

describe('recordLogin', () => {
	it('stamps last_login_at and audits the login', async () => {
		const u = await user();
		expect(u.lastLoginAt).toBeNull();
		await recordLogin(db, u.id);
		expect((await getUserById(db, u.id))?.lastLoginAt).toMatch(/^\d{4}-/);
		expect((await listAudit(db))[0]).toMatchObject({ action: 'login', actorId: u.id });
	});
});
