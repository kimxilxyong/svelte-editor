import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import { listAudit, recordAudit } from './audit.js';
import { AuthError } from './errors.js';
import { getAuthSettings, getSetting, setSetting, updateAuthSettings } from './settings.js';

let db: SqlClient;
beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

describe('settings', () => {
	it('defaults to open registration with the guest role', async () => {
		expect(await getAuthSettings(db)).toEqual({ allowRegistration: true, defaultRole: 'guest' });
	});

	it('upserts generic settings', async () => {
		await setSetting(db, 'x', '1');
		await setSetting(db, 'x', '2');
		expect(await getSetting(db, 'x')).toBe('2');
		expect(await getSetting(db, 'missing')).toBeNull();
	});

	it('updates partially and persists', async () => {
		await updateAuthSettings(db, { allowRegistration: false });
		expect(await getAuthSettings(db)).toEqual({ allowRegistration: false, defaultRole: 'guest' });
		await updateAuthSettings(db, { defaultRole: 'user' });
		expect(await getAuthSettings(db)).toEqual({ allowRegistration: false, defaultRole: 'user' });
	});

	it('never allows admin (or garbage) as default role', async () => {
		await expect(updateAuthSettings(db, { defaultRole: 'admin' })).rejects.toBeInstanceOf(
			AuthError
		);
		await expect(updateAuthSettings(db, { defaultRole: 'root' as never })).rejects.toBeInstanceOf(
			AuthError
		);
		await setSetting(db, 'auth.defaultRole', 'admin');
		expect((await getAuthSettings(db)).defaultRole).toBe('guest');
	});
});

describe('audit', () => {
	it('records and lists newest first, sanitising control characters', async () => {
		await recordAudit(db, { action: 'login', actor: { id: 'u1', label: 'a@b.co' } });
		await recordAudit(db, { action: 'settings_update', target: 'x\ny', detail: 'd' });
		const entries = await listAudit(db, 10);
		expect(entries.map((e) => e.action)).toEqual(['settings_update', 'login']);
		expect(entries[0].target).toBe('x y');
		expect(entries[1].actorLabel).toBe('a@b.co');
	});

	it('never throws when the table is missing', async () => {
		const broken = openSqliteClient(':memory:');
		await expect(recordAudit(broken, { action: 'login' })).resolves.toBeUndefined();
	});
});
