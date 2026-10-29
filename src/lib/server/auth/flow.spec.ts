import { beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../database/schema.js';
import { openSqliteClient } from '../database/sqlite-client.js';
import type { SqlClient } from '../database/types.js';
import { listAudit } from './audit.js';
import { AuthError } from './errors.js';
import { createInitialAdmin, needsSetup, signInWithProfile, type ExternalProfile } from './flow.js';
import { createSession, validateSessionToken } from './sessions.js';
import { updateAuthSettings } from './settings.js';
import {
	countUsers,
	createUser,
	getUserByEmail,
	getUserById,
	updateUser,
	verifyCredentials
} from './users.js';
import { createRateLimiter } from './rate-limit.js';

const PASSWORD = 'correct horse battery';
const WALLET = '0xabcdef0123456789abcdef0123456789abcdef01';
const ctx = { ip: '127.0.0.1' };
let db: SqlClient;

const github = (patch: Partial<ExternalProfile> = {}): ExternalProfile => ({
	provider: 'github',
	providerUserId: '1001',
	email: 'octo@example.com',
	emailVerified: true,
	name: 'Octo Cat',
	label: 'octocat',
	...patch
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

beforeEach(async () => {
	db = openSqliteClient(':memory:');
	await ensureSchema(db);
});

async function seedAdmin() {
	return createInitialAdmin(db, { email: 'admin@example.com', name: 'Admin', password: PASSWORD });
}

describe('first-run setup', () => {
	it('needs setup until a user exists; the first user is admin', async () => {
		expect(await needsSetup(db)).toBe(true);
		const admin = await seedAdmin();
		expect(admin.role).toBe('admin');
		expect(await needsSetup(db)).toBe(false);
		expect((await listAudit(db))[0].action).toBe('setup');
	});

	it('refuses a second setup', async () => {
		await seedAdmin();
		expect(
			await code(createInitialAdmin(db, { email: 'x@example.com', name: 'X', password: PASSWORD }))
		).toBe('setup_closed');
	});

	it('does not create two admins on concurrent submissions', async () => {
		const results = await Promise.allSettled([
			createInitialAdmin(db, { email: 'a@example.com', name: 'A', password: PASSWORD }),
			createInitialAdmin(db, { email: 'b@example.com', name: 'B', password: PASSWORD })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await countUsers(db)).toBe(1);
	});

	it('validates the admin input', async () => {
		expect(
			await code(createInitialAdmin(db, { email: 'bad', name: 'A', password: PASSWORD }))
		).toBe('invalid_input');
		expect(
			await code(createInitialAdmin(db, { email: 'a@example.com', name: 'A', password: 'short' }))
		).toBe('weak_password');
		expect(await needsSetup(db)).toBe(true);
	});

	it('the admin can sign in with the password', async () => {
		await seedAdmin();
		const limiter = createRateLimiter({ max: 5, windowMs: 1000 });
		const signedIn = await verifyCredentials(db, 'admin@example.com', PASSWORD, {
			ip: 'x',
			limiter,
			ipLimiter: limiter
		});
		expect(signedIn.role).toBe('admin');
	});
});

describe('signInWithProfile', () => {
	beforeEach(async () => {
		await seedAdmin();
	});

	it('registers a new account with the default role', async () => {
		const result = await signInWithProfile(db, github(), ctx);
		expect(result).toMatchObject({ created: true, linked: false });
		expect(result.user).toMatchObject({
			email: 'octo@example.com',
			emailVerified: true,
			name: 'Octo Cat',
			role: 'guest',
			hasPassword: false
		});
		expect(result.user.identities[0]).toMatchObject({ provider: 'github', label: 'octocat' });
		expect((await listAudit(db))[0].action).toBe('register');
	});

	it('uses the configured default role', async () => {
		await updateAuthSettings(db, { defaultRole: 'user' });
		expect((await signInWithProfile(db, github(), ctx)).user.role).toBe('user');
	});

	it('signs an existing identity in without creating anything', async () => {
		const first = await signInWithProfile(db, github(), ctx);
		const again = await signInWithProfile(db, github({ email: 'changed@example.com' }), ctx);
		expect(again).toMatchObject({ created: false, linked: false });
		expect(again.user.id).toBe(first.user.id);
		expect(await countUsers(db)).toBe(2);
	});

	it('refuses disabled users, also via identity', async () => {
		const first = await signInWithProfile(db, github(), ctx);
		const admin = (await getUserByEmail(db, 'admin@example.com'))!;
		await updateUser(db, first.user.id, { disabled: true }, admin.id);
		expect(await code(signInWithProfile(db, github(), ctx))).toBe('account_disabled');
	});

	it('closes registration but still lets known identities in', async () => {
		const first = await signInWithProfile(db, github(), ctx);
		await updateAuthSettings(db, { allowRegistration: false });
		expect(
			await code(signInWithProfile(db, github({ providerUserId: '2', email: null }), ctx))
		).toBe('registration_closed');
		expect((await signInWithProfile(db, github(), ctx)).user.id).toBe(first.user.id);
		expect(await countUsers(db)).toBe(2);
	});

	it('refuses to register while the first-run setup is pending', async () => {
		const empty = openSqliteClient(':memory:');
		await ensureSchema(empty);
		expect(await code(signInWithProfile(empty, github(), ctx))).toBe('registration_closed');
	});

	it('auto-links to an account with the same VERIFIED email', async () => {
		const existing = await createUser(db, {
			email: 'octo@example.com',
			name: 'Octo',
			password: PASSWORD,
			role: 'user',
			emailVerified: true
		});
		const result = await signInWithProfile(db, github(), ctx);
		expect(result).toMatchObject({ created: false, linked: true });
		expect(result.user.id).toBe(existing.id);
		expect(result.user.identities).toHaveLength(1);
		expect(result.user.hasPassword).toBe(true);
		expect(await countUsers(db)).toBe(2);
	});

	it('links even when registration is closed (it is not a registration)', async () => {
		await createUser(db, {
			email: 'octo@example.com',
			name: 'Octo',
			password: PASSWORD,
			role: 'user',
			emailVerified: true
		});
		await updateAuthSettings(db, { allowRegistration: false });
		expect((await signInWithProfile(db, github(), ctx)).linked).toBe(true);
	});

	it('does NOT link on an unverified provider email, and does not store it', async () => {
		const existing = await createUser(db, {
			email: 'octo@example.com',
			name: 'Octo',
			password: PASSWORD,
			role: 'admin',
			emailVerified: true
		});
		const result = await signInWithProfile(db, github({ emailVerified: false }), ctx);
		expect(result.created).toBe(true);
		expect(result.user.id).not.toBe(existing.id);
		expect(result.user.email).toBeNull();
		expect(result.user.role).toBe('guest');
	});

	it('pre-hijack defence: linking into an unverified account drops its password and sessions', async () => {
		const squatted = await createUser(db, {
			email: 'octo@example.com',
			name: 'Squatter',
			password: PASSWORD,
			role: 'user'
		});
		const { token } = await createSession(db, squatted.id);
		const result = await signInWithProfile(db, github(), ctx);
		expect(result.linked).toBe(true);
		expect(result.user).toMatchObject({ id: squatted.id, emailVerified: true, hasPassword: false });
		expect(await validateSessionToken(db, token)).toBeNull();
	});

	it('refuses auto-link into a disabled account', async () => {
		const target = await createUser(db, {
			email: 'octo@example.com',
			name: 'Octo',
			password: PASSWORD,
			role: 'user'
		});
		const admin = (await getUserByEmail(db, 'admin@example.com'))!;
		await updateUser(db, target.id, { disabled: true }, admin.id);
		expect(await code(signInWithProfile(db, github(), ctx))).toBe('account_disabled');
	});

	it('handles profiles without name or email', async () => {
		const result = await signInWithProfile(
			db,
			github({ email: null, name: '   ', label: 'octocat' }),
			ctx
		);
		expect(result.user).toMatchObject({ email: null, name: 'octocat' });
		const bare = await signInWithProfile(
			db,
			github({ providerUserId: '9', email: null, name: '', label: undefined }),
			ctx
		);
		expect(bare.user.name).toBe('New user');
	});

	it('registers wallet users with a lower-cased address identity', async () => {
		const profile: ExternalProfile = {
			provider: 'wallet',
			providerUserId: WALLET,
			email: null,
			emailVerified: false,
			name: '0xabcd…ef01'
		};
		const result = await signInWithProfile(db, profile, ctx);
		expect(result.created).toBe(true);
		const again = await signInWithProfile(
			db,
			{ ...profile, providerUserId: WALLET.toUpperCase().replace('0X', '0x') },
			ctx
		);
		expect(again).toMatchObject({ created: false, linked: false });
		expect(again.user.id).toBe(result.user.id);
	});

	describe('link mode (signed-in user adds a method)', () => {
		it('attaches the identity to the given user, regardless of email or registration policy', async () => {
			await updateAuthSettings(db, { allowRegistration: false });
			const me = await createUser(db, {
				email: 'me@example.com',
				name: 'Me',
				password: PASSWORD,
				role: 'user'
			});
			const result = await signInWithProfile(db, github({ email: 'other@example.com' }), {
				...ctx,
				linkToUserId: me.id
			});
			expect(result).toMatchObject({ created: false, linked: true });
			expect(result.user.id).toBe(me.id);
			expect(result.user.email).toBe('me@example.com');
			expect((await getUserById(db, me.id))?.identities).toHaveLength(1);
		});

		it('is idempotent for the same user and refuses identities of another user', async () => {
			const me = await createUser(db, {
				email: 'me@example.com',
				name: 'Me',
				password: PASSWORD,
				role: 'user'
			});
			const other = await createUser(db, {
				email: 'o@example.com',
				name: 'O',
				password: PASSWORD,
				role: 'user'
			});
			await signInWithProfile(db, github(), { ...ctx, linkToUserId: me.id });
			expect(await signInWithProfile(db, github(), { ...ctx, linkToUserId: me.id })).toMatchObject({
				linked: false
			});
			expect(await code(signInWithProfile(db, github(), { ...ctx, linkToUserId: other.id }))).toBe(
				'identity_taken'
			);
		});

		it('fails for unknown or disabled target users', async () => {
			expect(await code(signInWithProfile(db, github(), { ...ctx, linkToUserId: 'missing' }))).toBe(
				'not_found'
			);
			const me = await createUser(db, {
				email: 'me@example.com',
				name: 'Me',
				password: PASSWORD,
				role: 'user'
			});
			const admin = (await getUserByEmail(db, 'admin@example.com'))!;
			await updateUser(db, me.id, { disabled: true }, admin.id);
			expect(await code(signInWithProfile(db, github(), { ...ctx, linkToUserId: me.id }))).toBe(
				'account_disabled'
			);
		});
	});
});
