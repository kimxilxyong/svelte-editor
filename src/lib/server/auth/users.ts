/**
 * @fileoverview User repository and account-level business rules (`users` + `user_identities`).
 *
 * Every function takes the {@link SqlClient} as its first argument so the module works unchanged on
 * SQLite and PostgreSQL and is trivially testable with an in-memory database.
 *
 * ## Invariants enforced here (not in the UI)
 * - Emails are stored lower-cased and are unique; wallet-only / OAuth-only users may have none.
 * - The last *active* admin can never be deleted, disabled or demoted (`last_admin`).
 * - A user can never delete themself through {@link deleteUser}, and cannot remove their last
 *   remaining sign-in method (`last_sign_in_method`).
 * - Disabling or deleting a user, or resetting a password, revokes all of the user's sessions.
 * - The password hash never leaves this module: {@link UserRecord} only exposes `hasPassword`.
 *
 * ## Audit
 * This module records `login_failed`, `user_update`, `user_delete`, `identity_link`,
 * `identity_unlink` and (through {@link recordLogin}) `login`. Callers record `user_create`,
 * `password_change`, `password_reset`, `logout` themselves because only they know the context.
 */

import { isRole, type Role } from '../../auth/roles.js';
import {
	identityProviders,
	type IdentityProvider,
	type UserIdentity,
	type UserRecord
} from '../../auth/types.js';
import {
	isWalletAddress,
	normalizeEmail,
	shortAddress,
	validateName,
	validatePassword
} from '../../auth/validation.js';
import type { SqlClient, SqlParam } from '../database/types.js';
import { recordAudit } from './audit.js';
import { AuthError } from './errors.js';
import { hashPassword, verifyPasswordOrDummy } from './passwords.js';
import { loginIpLimiter, loginLimiter, type RateLimiter } from './rate-limit.js';
import { invalidateUserSessions } from './sessions.js';

/** An external identity to attach to a user. */
export type IdentityInput = {
	provider: IdentityProvider;
	/** Stable id at the provider (GitHub numeric id, OIDC `sub`, lower-case wallet address). */
	providerUserId: string;
	/** Display hint; defaults to the shortened address for wallets. */
	label?: string | null;
};

/** Input of {@link createUser}. */
export type CreateUserInput = {
	email?: string | null;
	name: string;
	/** Plain-text password; hashed with Argon2id. Omit for OAuth/wallet-only accounts. */
	password?: string | null;
	role: Role;
	/** Whether the email is known to be owned by the user (e.g. asserted by an OAuth provider). */
	emailVerified?: boolean;
	identity?: IdentityInput;
};

/** Editable fields in {@link updateUser}. */
export type UserPatch = { name?: string; email?: string; role?: Role; disabled?: boolean };

/** Options of {@link listUsers}. */
export type ListUsersOptions = {
	/** Case-insensitive substring of name or email. */
	search?: string;
	role?: Role;
	status?: 'active' | 'disabled';
	/** Page size, 1–200 (default 50). */
	limit?: number;
	offset?: number;
};

type UserRow = {
	id: string;
	email: string | null;
	email_verified: number;
	name: string;
	role: string;
	disabled: number;
	has_password: number;
	created_at: string;
	updated_at: string;
	last_login_at: string | null;
};

type IdentityRow = {
	id: string;
	user_id: string;
	provider: string;
	label: string | null;
	created_at: string;
};

const userColumns = `id, email, email_verified, name, role, disabled,
	CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
	created_at, updated_at, last_login_at`;

/** Maps DB rows to the public {@link UserRecord} shape. */
function toRecord(row: UserRow, identities: IdentityRow[]): UserRecord {
	return {
		id: row.id,
		email: row.email,
		emailVerified: Number(row.email_verified) === 1,
		name: row.name,
		role: isRole(row.role) ? row.role : 'guest',
		disabled: Number(row.disabled) === 1,
		hasPassword: Number(row.has_password) === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastLoginAt: row.last_login_at,
		identities: identities.map((i): UserIdentity => ({
			id: i.id,
			provider: i.provider as IdentityProvider,
			label: i.label,
			createdAt: i.created_at
		}))
	};
}

/** Whether a driver error is a unique-constraint violation (SQLite message / PostgreSQL 23505). */
function isUniqueViolation(error: unknown): boolean {
	const e = error as { code?: string; message?: string } | null;
	return e?.code === '23505' || /unique|duplicate/i.test(e?.message ?? '');
}

/** Loads the identities of a set of users in one query, grouped by user id. */
async function loadIdentities(
	db: SqlClient,
	userIds: string[]
): Promise<Map<string, IdentityRow[]>> {
	const grouped = new Map<string, IdentityRow[]>();
	if (userIds.length === 0) return grouped;
	const rows = await db.all<IdentityRow>(
		`SELECT id, user_id, provider, label, created_at FROM user_identities
		 WHERE user_id IN (${userIds.map(() => '?').join(', ')}) ORDER BY created_at, id`,
		userIds
	);
	for (const row of rows) {
		const list = grouped.get(row.user_id) ?? [];
		list.push(row);
		grouped.set(row.user_id, list);
	}
	return grouped;
}

/** Validates/normalises an identity; wallet ids are lower-cased so lookups are case-insensitive. */
function cleanIdentity(input: IdentityInput): {
	provider: IdentityProvider;
	providerUserId: string;
	label: string | null;
} {
	if (!(identityProviders as readonly string[]).includes(input.provider)) {
		throw new AuthError('invalid_input', 'Unknown identity provider.');
	}
	let providerUserId = typeof input.providerUserId === 'string' ? input.providerUserId.trim() : '';
	if (providerUserId.length === 0 || providerUserId.length > 200) {
		throw new AuthError('invalid_input', 'Invalid provider user id.');
	}
	let label = input.label?.trim().slice(0, 100) || null;
	if (input.provider === 'wallet') {
		if (!isWalletAddress(providerUserId)) {
			throw new AuthError('invalid_input', 'Invalid wallet address.');
		}
		providerUserId = providerUserId.toLowerCase();
		label ??= shortAddress(providerUserId);
	}
	return { provider: input.provider, providerUserId, label };
}

/** Inserts an identity row, mapping the unique violation to `identity_taken`. */
async function insertIdentity(
	db: SqlClient,
	userId: string,
	input: IdentityInput
): Promise<UserIdentity> {
	const identity = cleanIdentity(input);
	const existing = await db.get(
		'SELECT id FROM user_identities WHERE provider = ? AND provider_user_id = ?',
		[identity.provider, identity.providerUserId]
	);
	if (existing) {
		throw new AuthError('identity_taken', 'This sign-in method is already linked to an account.');
	}
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	try {
		await db.run(
			`INSERT INTO user_identities (id, user_id, provider, provider_user_id, label, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[id, userId, identity.provider, identity.providerUserId, identity.label, createdAt]
		);
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new AuthError('identity_taken', 'This sign-in method is already linked to an account.');
		}
		throw error;
	}
	return { id, provider: identity.provider, label: identity.label, createdAt };
}

/** Short human label of a user for audit entries. */
function auditLabel(user: { email: string | null; name: string }): string {
	return user.email ?? user.name;
}

/**
 * Counts all users (used for first-run detection).
 * @param db - Database client.
 */
export async function countUsers(db: SqlClient): Promise<number> {
	const row = await db.get<{ n: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users');
	return Number(row?.n ?? 0);
}

/**
 * Counts admins that are not disabled.
 * @param db - Database client.
 */
export async function countActiveAdmins(db: SqlClient): Promise<number> {
	const row = await db.get<{ n: number }>(
		`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE role = 'admin' AND disabled = 0`
	);
	return Number(row?.n ?? 0);
}

/**
 * Loads a user with identities.
 * @param db - Database client.
 * @param id - User id.
 * @returns The record, or `null` when unknown.
 */
export async function getUserById(db: SqlClient, id: string): Promise<UserRecord | null> {
	const row = await db.get<UserRow>(`SELECT ${userColumns} FROM users WHERE id = ?`, [id]);
	if (!row) return null;
	return toRecord(row, (await loadIdentities(db, [row.id])).get(row.id) ?? []);
}

/**
 * Loads a user by email.
 * @param db - Database client.
 * @param email - Any casing; normalised first. Invalid emails return `null`.
 */
export async function getUserByEmail(db: SqlClient, email: string): Promise<UserRecord | null> {
	const normalized = normalizeEmail(email);
	if (!normalized) return null;
	const row = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [normalized]);
	return row ? getUserById(db, row.id) : null;
}

/**
 * Finds the user owning an external identity.
 * @param db - Database client.
 * @param provider - Identity provider.
 * @param providerUserId - Id at the provider (wallet addresses are matched case-insensitively).
 */
export async function findUserByIdentity(
	db: SqlClient,
	provider: IdentityProvider,
	providerUserId: string
): Promise<UserRecord | null> {
	const key = provider === 'wallet' ? providerUserId.toLowerCase() : providerUserId;
	const row = await db.get<{ user_id: string }>(
		'SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?',
		[provider, key]
	);
	return row ? getUserById(db, row.user_id) : null;
}

/**
 * Lists users with optional filters, newest first.
 * @param db - Database client.
 * @param options - Search, role/status filter and paging.
 * @returns The page of users and the total number of matches.
 */
export async function listUsers(
	db: SqlClient,
	options: ListUsersOptions = {}
): Promise<{ users: UserRecord[]; total: number }> {
	const where: string[] = [];
	const params: SqlParam[] = [];
	const search = options.search?.trim().toLowerCase();
	if (search) {
		// '!' is the LIKE escape character so user-typed % and _ match literally.
		const pattern = `%${search.replace(/[!%_]/g, (c) => '!' + c)}%`;
		where.push(`(LOWER(name) LIKE ? ESCAPE '!' OR LOWER(COALESCE(email, '')) LIKE ? ESCAPE '!')`);
		params.push(pattern, pattern);
	}
	if (options.role && isRole(options.role)) {
		where.push('role = ?');
		params.push(options.role);
	}
	if (options.status === 'active') where.push('disabled = 0');
	if (options.status === 'disabled') where.push('disabled = 1');
	const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50) || 50));
	const offset = Math.max(0, Math.trunc(options.offset ?? 0) || 0);

	const totalRow = await db.get<{ n: number }>(
		`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users ${clause}`,
		params
	);
	const rows = await db.all<UserRow>(
		`SELECT ${userColumns} FROM users ${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
		[...params, limit, offset]
	);
	const identities = await loadIdentities(
		db,
		rows.map((r) => r.id)
	);
	return {
		users: rows.map((r) => toRecord(r, identities.get(r.id) ?? [])),
		total: Number(totalRow?.n ?? 0)
	};
}

/**
 * Creates a user (self-registration, admin creation, first-run setup, OAuth/wallet sign-up).
 * Does **not** check registration policy – that is the caller's job (see `flow.ts`).
 * @param db - Database client.
 * @param input - Account data; needs a password or an identity so the user can sign in.
 * @returns The created record.
 * @throws {AuthError} `invalid_input`, `weak_password`, `email_taken`, `identity_taken`.
 * @example
 * await createUser(db, { email: 'a@b.co', name: 'Ada', password: 'correct horse battery', role: 'user' });
 */
export async function createUser(db: SqlClient, input: CreateUserInput): Promise<UserRecord> {
	const name = validateName(input.name);
	if (!name) throw new AuthError('invalid_input', 'Enter a name (1–80 characters).');
	if (!isRole(input.role)) throw new AuthError('invalid_input', 'Invalid role.');
	let email: string | null = null;
	if (input.email != null && input.email !== '') {
		email = normalizeEmail(input.email);
		if (!email) throw new AuthError('invalid_input', 'Enter a valid email address.');
	}
	const password = input.password ? input.password : null;
	if (password) {
		const problem = validatePassword(password, { email, name });
		if (problem) throw new AuthError('weak_password', problem);
	}
	if (!password && !input.identity) {
		throw new AuthError('invalid_input', 'An account needs a password or a linked sign-in method.');
	}
	if (password && !email) {
		throw new AuthError('invalid_input', 'A password account needs an email address.');
	}
	// Hash before opening the transaction: Argon2 is deliberately slow.
	const passwordHash = password ? await hashPassword(password) : null;
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	try {
		await db.transaction(async (tx) => {
			if (email && (await tx.get('SELECT id FROM users WHERE email = ?', [email]))) {
				throw new AuthError('email_taken', 'An account with this email already exists.');
			}
			await tx.run(
				`INSERT INTO users (id, email, email_verified, name, password_hash, role, disabled, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
				[id, email, email && input.emailVerified ? 1 : 0, name, passwordHash, input.role, now, now]
			);
			if (input.identity) await insertIdentity(tx, id, input.identity);
		});
	} catch (error) {
		if (isUniqueViolation(error) && !(error instanceof AuthError)) {
			throw new AuthError('email_taken', 'An account with this email already exists.');
		}
		throw error;
	}
	return (await getUserById(db, id))!;
}

/**
 * Updates name, email, role or disabled state, enforcing the last-admin rule.
 * Disabling a user revokes all of their sessions.
 * @param db - Database client.
 * @param id - User to change.
 * @param patch - Fields to change.
 * @param actorId - User performing the change (audit trail).
 * @returns The updated record.
 * @throws {AuthError} `not_found`, `invalid_input`, `email_taken`, `last_admin`.
 */
export async function updateUser(
	db: SqlClient,
	id: string,
	patch: UserPatch,
	actorId: string
): Promise<UserRecord> {
	const sets: string[] = [];
	const params: SqlParam[] = [];
	if (patch.name !== undefined) {
		const name = validateName(patch.name);
		if (!name) throw new AuthError('invalid_input', 'Enter a name (1–80 characters).');
		sets.push('name = ?');
		params.push(name);
	}
	let email: string | undefined;
	if (patch.email !== undefined) {
		const normalized = normalizeEmail(patch.email);
		if (!normalized) throw new AuthError('invalid_input', 'Enter a valid email address.');
		email = normalized;
	}
	if (patch.role !== undefined && !isRole(patch.role)) {
		throw new AuthError('invalid_input', 'Invalid role.');
	}
	const changes: string[] = [];

	await db.transaction(async (tx) => {
		const target = await tx.get<{
			role: string;
			disabled: number;
			email: string | null;
			name: string;
		}>('SELECT role, disabled, email, name FROM users WHERE id = ?', [id]);
		if (!target) throw new AuthError('not_found', 'User not found.');

		const isActiveAdmin = target.role === 'admin' && Number(target.disabled) === 0;
		const losesAdmin =
			(patch.role !== undefined && patch.role !== 'admin') || patch.disabled === true;
		if (isActiveAdmin && losesAdmin && (await countActiveAdmins(tx)) <= 1) {
			throw new AuthError('last_admin', 'The last active admin cannot be demoted or disabled.');
		}
		if (email !== undefined && email !== target.email) {
			if (await tx.get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id])) {
				throw new AuthError('email_taken', 'An account with this email already exists.');
			}
			// The new address has not been proven by its owner.
			sets.push('email = ?', 'email_verified = 0');
			params.push(email);
			changes.push('email');
		}
		if (patch.name !== undefined && patch.name !== target.name) changes.push('name');
		if (patch.role !== undefined) {
			sets.push('role = ?');
			params.push(patch.role);
			if (patch.role !== target.role) changes.push(`role ${target.role}→${patch.role}`);
		}
		if (patch.disabled !== undefined) {
			sets.push('disabled = ?');
			params.push(patch.disabled ? 1 : 0);
			if (patch.disabled !== (Number(target.disabled) === 1)) {
				changes.push(patch.disabled ? 'disabled' : 'enabled');
			}
		}
		if (sets.length > 0) {
			await tx.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [
				...params,
				new Date().toISOString(),
				id
			]);
		}
	});

	if (patch.disabled === true) await invalidateUserSessions(db, id);
	const updated = (await getUserById(db, id))!;
	const actor = await getUserById(db, actorId);
	await recordAudit(db, {
		actor: actor ? { id: actor.id, label: auditLabel(actor) } : null,
		action: 'user_update',
		target: auditLabel(updated),
		detail: changes.join(', ') || null
	});
	return updated;
}

/**
 * Sets a new password.
 * @param db - Database client.
 * @param id - User id.
 * @param password - New plain-text password (policy-checked against the user's email and name).
 * @param options - `revokeSessions` (default `true`) deletes sessions; `exceptSessionId` keeps the
 *   caller's own session when changing one's own password.
 * @throws {AuthError} `not_found`, `weak_password`.
 */
export async function setUserPassword(
	db: SqlClient,
	id: string,
	password: string,
	options: { revokeSessions?: boolean; exceptSessionId?: string } = {}
): Promise<void> {
	const user = await db.get<{ email: string | null; name: string }>(
		'SELECT email, name FROM users WHERE id = ?',
		[id]
	);
	if (!user) throw new AuthError('not_found', 'User not found.');
	const problem = validatePassword(password, user);
	if (problem) throw new AuthError('weak_password', problem);
	const hash = await hashPassword(password);
	await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
		hash,
		new Date().toISOString(),
		id
	]);
	if (options.revokeSessions ?? true) await invalidateUserSessions(db, id, options.exceptSessionId);
}

/** Context for {@link verifyCredentials}. */
export type CredentialContext = {
	/** Client IP; part of the rate-limit keys. */
	ip: string;
	/** Per `ip+email` limiter override (tests). */
	limiter?: RateLimiter;
	/** Per-IP limiter override (tests). */
	ipLimiter?: RateLimiter;
};

/**
 * Verifies an email/password pair with brute-force protection.
 *
 * Unknown emails and wrong passwords are indistinguishable (same message, comparable timing via a
 * dummy hash). The caller creates the session and calls {@link recordLogin}.
 * @param db - Database client.
 * @param email - Entered email (any casing).
 * @param password - Entered password.
 * @param ctx - Client IP and optional limiter overrides.
 * @returns The authenticated user.
 * @throws {AuthError} `rate_limited`, `invalid_credentials`, `account_disabled`.
 */
export async function verifyCredentials(
	db: SqlClient,
	email: string,
	password: string,
	ctx: CredentialContext
): Promise<UserRecord> {
	const limiter = ctx.limiter ?? loginLimiter;
	const ipLimiter = ctx.ipLimiter ?? loginIpLimiter;
	const normalized = normalizeEmail(email);
	const key = `${ctx.ip}|${normalized ?? String(email).slice(0, 100).toLowerCase()}`;

	for (const decision of [limiter.check(key), ipLimiter.check(ctx.ip)]) {
		if (!decision.allowed) {
			throw new AuthError(
				'rate_limited',
				`Too many failed attempts. Try again in ${Math.ceil(decision.retryAfterSeconds / 60)} minute(s).`
			);
		}
	}

	const row = normalized
		? await db.get<{ id: string; password_hash: string | null; disabled: number }>(
				'SELECT id, password_hash, disabled FROM users WHERE email = ?',
				[normalized]
			)
		: undefined;
	const ok = await verifyPasswordOrDummy(row?.password_hash ?? null, String(password));
	if (!row || !ok) {
		limiter.fail(key);
		ipLimiter.fail(ctx.ip);
		await recordAudit(db, {
			action: 'login_failed',
			target: normalized ?? 'invalid email',
			detail: `ip ${ctx.ip}`
		});
		throw new AuthError('invalid_credentials', 'Invalid email or password');
	}
	// Only reveal "disabled" after the password was proven correct.
	if (Number(row.disabled) === 1) {
		throw new AuthError('account_disabled', 'This account has been disabled.');
	}
	limiter.reset(key);
	return (await getUserById(db, row.id))!;
}

/**
 * Deletes a user together with their identities and sessions.
 * @param db - Database client.
 * @param id - User to delete.
 * @param actorId - Administrator performing the deletion.
 * @throws {AuthError} `forbidden` (self-deletion), `not_found`, `last_admin`.
 */
export async function deleteUser(db: SqlClient, id: string, actorId: string): Promise<void> {
	if (id === actorId) throw new AuthError('forbidden', 'You cannot delete your own account here.');
	const target = await db.transaction(async (tx) => {
		const user = await tx.get<{
			role: string;
			disabled: number;
			email: string | null;
			name: string;
		}>('SELECT role, disabled, email, name FROM users WHERE id = ?', [id]);
		if (!user) throw new AuthError('not_found', 'User not found.');
		if (
			user.role === 'admin' &&
			Number(user.disabled) === 0 &&
			(await countActiveAdmins(tx)) <= 1
		) {
			throw new AuthError('last_admin', 'The last active admin cannot be deleted.');
		}
		// Explicit deletes: do not rely on ON DELETE CASCADE (SQLite needs a PRAGMA for it).
		await tx.run('DELETE FROM sessions WHERE user_id = ?', [id]);
		await tx.run('DELETE FROM user_identities WHERE user_id = ?', [id]);
		await tx.run('DELETE FROM users WHERE id = ?', [id]);
		return user;
	});
	const actor = await getUserById(db, actorId);
	await recordAudit(db, {
		actor: actor ? { id: actor.id, label: auditLabel(actor) } : null,
		action: 'user_delete',
		target: auditLabel(target)
	});
}

/**
 * Links an external identity to an existing user.
 * @param db - Database client.
 * @param userId - Owner.
 * @param identity - Provider and provider-side id.
 * @returns The stored identity.
 * @throws {AuthError} `not_found`, `identity_taken`, `invalid_input`.
 */
export async function addIdentity(
	db: SqlClient,
	userId: string,
	identity: IdentityInput
): Promise<UserIdentity> {
	const user = await getUserById(db, userId);
	if (!user) throw new AuthError('not_found', 'User not found.');
	const created = await insertIdentity(db, userId, identity);
	await recordAudit(db, {
		actor: { id: user.id, label: auditLabel(user) },
		action: 'identity_link',
		target: auditLabel(user),
		detail: created.provider
	});
	return created;
}

/**
 * Unlinks an identity, refusing to remove the user's last sign-in method.
 * @param db - Database client.
 * @param userId - Owner.
 * @param identityId - Row id of the identity.
 * @throws {AuthError} `not_found`, `last_sign_in_method`.
 */
export async function removeIdentity(
	db: SqlClient,
	userId: string,
	identityId: string
): Promise<void> {
	const user = await getUserById(db, userId);
	const identity = user?.identities.find((i) => i.id === identityId);
	if (!user || !identity) throw new AuthError('not_found', 'Sign-in method not found.');
	const remaining = user.identities.length - 1 + (user.hasPassword ? 1 : 0);
	if (remaining < 1) {
		throw new AuthError('last_sign_in_method', 'You cannot remove your last sign-in method.');
	}
	await db.run('DELETE FROM user_identities WHERE id = ? AND user_id = ?', [identityId, userId]);
	await recordAudit(db, {
		actor: { id: user.id, label: auditLabel(user) },
		action: 'identity_unlink',
		target: auditLabel(user),
		detail: identity.provider
	});
}

/**
 * Stamps `last_login_at` and records the `login` audit event.
 * @param db - Database client.
 * @param userId - The user who just signed in.
 */
export async function recordLogin(db: SqlClient, userId: string): Promise<void> {
	const now = new Date().toISOString();
	await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, userId]);
	const user = await db.get<{ email: string | null; name: string }>(
		'SELECT email, name FROM users WHERE id = ?',
		[userId]
	);
	if (user) {
		await recordAudit(db, {
			actor: { id: userId, label: auditLabel(user) },
			action: 'login'
		});
	}
}
