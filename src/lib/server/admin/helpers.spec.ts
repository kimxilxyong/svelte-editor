import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError } from '../auth/errors.js';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import { createUser } from '../auth/users.js';
import {
	REPLACE_CONFIRM_WORD,
	auditActor,
	countUsersByRole,
	describeError,
	providerSetup,
	readCheckbox,
	readDatabaseForm,
	readString,
	scrubSecrets,
	statusForAuthError
} from './helpers.js';

const url = 'postgres://app:s3cr%40t!@db.internal:5432/prod';

describe('scrubSecrets', () => {
	it('removes the submitted URL, its password (also decoded) and user name', () => {
		const out = scrubSecrets(`connect ECONNREFUSED ${url} (password s3cr@t! for app)`, [url]);
		expect(out).not.toContain('s3cr');
		expect(out).not.toContain('db.internal');
		expect(out).toContain('[redacted]');
	});

	it('redacts foreign connection strings and userinfo as a fallback', () => {
		expect(scrubSecrets('bad postgresql://x:y@h/db here')).toBe('bad [redacted] here');
		expect(scrubSecrets('fetch https://user:pw@host/path failed')).toBe(
			'fetch https://[redacted]@host/path failed'
		);
		expect(scrubSecrets('failed with password=hunter22, retry')).toBe(
			'failed with password=[redacted], retry'
		);
	});

	it('ignores tiny secrets and truncates long text', () => {
		expect(scrubSecrets('abc', ['a'])).toBe('abc');
		expect(scrubSecrets('x'.repeat(1000)).length).toBeLessThanOrEqual(301);
	});
});

describe('describeError / statusForAuthError', () => {
	it('passes AuthError messages and hides unexpected errors by default', () => {
		expect(describeError(new AuthError('last_admin', 'No.'))).toBe('No.');
		expect(describeError(new Error('boom at /srv/x.ts:1'))).toBe(
			'Something went wrong. Please try again.'
		);
		expect(describeError('weird', { fallback: 'fb' })).toBe('fb');
	});

	it('shows scrubbed plain errors when allowed, never a stack', () => {
		const error = new Error(`cannot connect to ${url}`);
		const text = describeError(error, { exposeErrors: true, secrets: [url] });
		expect(text).toBe('cannot connect to [redacted]');
		expect(text).not.toContain(' at ');
	});

	it('maps codes to statuses', () => {
		expect(statusForAuthError(new AuthError('not_found', ''))).toBe(404);
		expect(statusForAuthError(new AuthError('forbidden', ''))).toBe(403);
		expect(statusForAuthError(new AuthError('email_taken', ''))).toBe(409);
		expect(statusForAuthError(new AuthError('last_admin', ''))).toBe(409);
		expect(statusForAuthError(new AuthError('weak_password', ''))).toBe(400);
		expect(statusForAuthError(new Error('x'))).toBe(500);
	});
});

describe('form readers', () => {
	it('reads strings and checkboxes defensively', () => {
		const form = new FormData();
		form.set('a', 'x'.repeat(50));
		form.set('c', 'on');
		form.set('f', new Blob(['x']), 'file.txt');
		expect(readString(form, 'a', 10)).toBe('x'.repeat(10));
		expect(readString(form, 'missing')).toBe('');
		expect(readString(form, 'f')).toBe('');
		expect(readCheckbox(form, 'c')).toBe(true);
		expect(readCheckbox(form, 'missing')).toBe(false);
	});

	it('keeps the PostgreSQL URL out of the returned values', () => {
		const form = new FormData();
		form.set('backend', 'postgres');
		form.set('postgresUrl', ` ${url} `);
		form.set('sqlitePath', ' data/x.db ');
		form.set('dataMode', 'keep');
		const parsed = readDatabaseForm(form);
		expect(parsed.candidate).toEqual({ backend: 'postgres', postgresUrl: url });
		expect(parsed.secrets).toEqual([url]);
		expect(parsed.values).toEqual({
			backend: 'postgres',
			sqlitePath: 'data/x.db',
			dataMode: 'keep'
		});
		expect(JSON.stringify(parsed.values)).not.toContain('s3cr');
	});

	it('defaults to sqlite/copy and flags unknown data modes', () => {
		const form = new FormData();
		form.set('backend', 'mysql');
		form.set('sqlitePath', 'a.db');
		form.set('dataMode', 'nuke');
		const parsed = readDatabaseForm(form);
		expect(parsed.candidate).toEqual({ backend: 'sqlite', sqlitePath: 'a.db' });
		expect(parsed.dataMode).toBeNull();
		expect(parsed.values.dataMode).toBe('copy');
	});

	it('requires both the tick and the typed word to confirm a replace', () => {
		const make = (tick: boolean, text: string) => {
			const form = new FormData();
			form.set('backend', 'sqlite');
			form.set('dataMode', 'replace');
			if (tick) form.set('confirmReplace', 'on');
			form.set('confirmText', text);
			return readDatabaseForm(form).replaceConfirmed;
		};
		expect(make(true, REPLACE_CONFIRM_WORD)).toBe(true);
		expect(make(true, ' REPLACE ')).toBe(true);
		expect(make(true, 'replace')).toBe(false);
		expect(make(false, REPLACE_CONFIRM_WORD)).toBe(false);
	});
});

describe('providerSetup', () => {
	it('derives env names and the callback URL', () => {
		expect(providerSetup('linkedin', 'https://a.test')).toEqual({
			clientId: 'LINKEDIN_CLIENT_ID',
			clientSecret: 'LINKEDIN_CLIENT_SECRET',
			callbackUrl: 'https://a.test/auth/linkedin/callback'
		});
	});
});

describe('countUsersByRole / auditActor', () => {
	let db: SqlClient;
	beforeEach(async () => {
		db = openSqliteClient(':memory:');
		await ensureSchema(db);
	});

	it('counts every role, including empty ones, and disabled users', async () => {
		const empty = await countUsersByRole(db);
		expect(empty).toEqual({
			byRole: { guest: 0, user: 0, poweruser: 0, admin: 0 },
			disabled: 0,
			total: 0
		});
		await createUser(db, {
			email: 'a@x.co',
			name: 'A',
			password: 'correct horse battery',
			role: 'admin'
		});
		await createUser(db, {
			email: 'b@x.co',
			name: 'B',
			password: 'correct horse battery',
			role: 'user'
		});
		await createUser(db, {
			email: 'c@x.co',
			name: 'C',
			password: 'correct horse battery',
			role: 'user'
		});
		await db.run("UPDATE users SET disabled = 1 WHERE email = 'c@x.co'");
		const counts = await countUsersByRole(db);
		expect(counts.byRole).toEqual({ guest: 0, user: 2, poweruser: 0, admin: 1 });
		expect(counts.disabled).toBe(1);
		expect(counts.total).toBe(3);
	});

	it('labels the actor by email, falling back to the name', () => {
		expect(auditActor({ id: '1', email: 'a@b.co', name: 'A' })).toEqual({
			id: '1',
			label: 'a@b.co'
		});
		expect(auditActor({ id: '2', email: null, name: 'Wallet' })).toEqual({
			id: '2',
			label: 'Wallet'
		});
	});
});
