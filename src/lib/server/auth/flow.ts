/**
 * @fileoverview Sign-in flows that combine several services: external-identity sign-in (OAuth and
 * wallet) and the first-run administrator setup.
 *
 * ## {@link signInWithProfile} decision table
 * 1. `linkToUserId` given (a signed-in user adds a method): attach the identity to that user, or
 *    fail with `identity_taken` when it belongs to somebody else.
 * 2. The identity is already linked: sign that user in (disabled users are refused).
 * 3. The provider asserts a **verified** email equal to an existing account's email: link the
 *    identity to that account (the provider proved ownership of the mailbox).
 * 4. Otherwise register a new account with the configured default role – unless registration is
 *    closed (`registration_closed`) or the first-run setup has not happened yet.
 *
 * Unverified provider emails are never used for linking and are not stored, so an attacker cannot
 * claim someone else's address through a lax provider.
 */

import type { IdentityProvider, UserRecord } from '../../auth/types.js';
import { normalizeEmail, validateName } from '../../auth/validation.js';
import type { SqlClient } from '../database/types.js';
import { recordAudit } from './audit.js';
import { AuthError } from './errors.js';
import { getAuthSettings } from './settings.js';
import { invalidateUserSessions } from './sessions.js';
import {
	addIdentity,
	countUsers,
	createUser,
	findUserByIdentity,
	getUserByEmail,
	getUserById
} from './users.js';

/** A profile returned by an external identity provider (OAuth or wallet). */
export type ExternalProfile = {
	provider: IdentityProvider;
	/** Stable id at the provider (OIDC `sub`, GitHub numeric id, lower-case wallet address). */
	providerUserId: string;
	/** Email reported by the provider, or `null`. */
	email: string | null;
	/** Whether the provider vouches that the user controls `email`. */
	emailVerified: boolean;
	/** Display name suggested by the provider. */
	name: string;
	/** Display hint stored with the identity (GitHub login, shortened address …). */
	label?: string;
};

/** Result of {@link signInWithProfile}. */
export type SignInResult = {
	user: UserRecord;
	/** A new account was registered. */
	created: boolean;
	/** An identity was newly attached to an existing account. */
	linked: boolean;
};

/**
 * Whether the application still needs its first administrator (`users` is empty).
 * @param db - Database client.
 */
export async function needsSetup(db: SqlClient): Promise<boolean> {
	return (await countUsers(db)) === 0;
}

/** Serialises first-run setups inside this process so a double submit cannot create two admins. */
let setupQueue: Promise<unknown> = Promise.resolve();

/**
 * Creates the very first user as `admin`. Only possible while no user exists.
 * @param db - Database client.
 * @param input - Email, display name and password of the administrator.
 * @returns The new admin.
 * @throws {AuthError} `setup_closed` when users already exist; validation errors from `createUser`.
 * @example
 * await createInitialAdmin(db, { email: 'admin@example.com', name: 'Admin', password: 'a long passphrase' });
 */
export function createInitialAdmin(
	db: SqlClient,
	input: { email: string; name: string; password: string }
): Promise<UserRecord> {
	const run = async () => {
		if (!(await needsSetup(db))) {
			throw new AuthError('setup_closed', 'Setup has already been completed.');
		}
		const admin = await createUser(db, {
			email: input.email,
			name: input.name,
			password: input.password,
			role: 'admin'
		});
		await recordAudit(db, {
			actor: { id: admin.id, label: admin.email ?? admin.name },
			action: 'setup',
			target: admin.email ?? admin.name
		});
		return admin;
	};
	const result = setupQueue.then(run, run);
	setupQueue = result.catch(() => undefined);
	return result;
}

/** Picks a valid display name from what the provider gave us. */
function displayName(profile: ExternalProfile): string {
	return (
		validateName(profile.name?.slice(0, 80)) ??
		validateName(profile.label?.slice(0, 80)) ??
		'New user'
	);
}

/**
 * Signs a user in (or up, or links) from a provider profile. The caller creates the session.
 * @param db - Database client.
 * @param profile - Identity asserted by OAuth or wallet verification.
 * @param ctx - `ip` is reserved for logging; `linkToUserId` switches to "add method" mode.
 * @returns The user plus whether they were created or the identity linked.
 * @throws {AuthError} `account_disabled`, `identity_taken`, `registration_closed`, `not_found`,
 *   `invalid_input`.
 */
export async function signInWithProfile(
	db: SqlClient,
	profile: ExternalProfile,
	ctx: { ip: string; linkToUserId?: string }
): Promise<SignInResult> {
	const identity = {
		provider: profile.provider,
		providerUserId: profile.providerUserId,
		label: profile.label ?? null
	};
	const existing = await findUserByIdentity(db, profile.provider, profile.providerUserId);

	// 1. Explicit linking by a signed-in user.
	if (ctx.linkToUserId) {
		if (existing) {
			if (existing.id === ctx.linkToUserId)
				return { user: existing, created: false, linked: false };
			throw new AuthError('identity_taken', 'This sign-in method belongs to another account.');
		}
		const target = await getUserById(db, ctx.linkToUserId);
		if (!target) throw new AuthError('not_found', 'User not found.');
		if (target.disabled) throw new AuthError('account_disabled', 'This account has been disabled.');
		await addIdentity(db, target.id, identity);
		return { user: (await getUserById(db, target.id))!, created: false, linked: true };
	}

	// 2. Known identity.
	if (existing) {
		if (existing.disabled)
			throw new AuthError('account_disabled', 'This account has been disabled.');
		return { user: existing, created: false, linked: false };
	}

	// Only a verified, well-formed email counts; otherwise it is ignored entirely.
	const verifiedEmail = profile.emailVerified ? normalizeEmail(profile.email) : null;

	// 3. Auto-link by verified email.
	if (verifiedEmail) {
		const match = await getUserByEmail(db, verifiedEmail);
		if (match) {
			if (match.disabled)
				throw new AuthError('account_disabled', 'This account has been disabled.');
			await addIdentity(db, match.id, identity);
			if (!match.emailVerified) {
				// Pre-hijacking defence: someone may have registered this address with a password
				// before its real owner showed up. The owner just proved the mailbox, so mark it
				// verified and drop any password and sessions set while it was unproven.
				await db.run(
					'UPDATE users SET email_verified = 1, password_hash = NULL, updated_at = ? WHERE id = ?',
					[new Date().toISOString(), match.id]
				);
				await invalidateUserSessions(db, match.id);
			}
			return { user: (await getUserById(db, match.id))!, created: false, linked: true };
		}
	}

	// 4. Register.
	if (await needsSetup(db)) {
		throw new AuthError('registration_closed', 'Complete the first-run setup before signing in.');
	}
	const settings = await getAuthSettings(db);
	if (!settings.allowRegistration) {
		throw new AuthError('registration_closed', 'Registration is currently closed.');
	}
	const user = await createUser(db, {
		email: verifiedEmail,
		name: displayName(profile),
		role: settings.defaultRole,
		emailVerified: verifiedEmail !== null,
		identity
	});
	await recordAudit(db, {
		actor: { id: user.id, label: user.email ?? user.name },
		action: 'register',
		target: user.email ?? user.name,
		detail: `${profile.provider}, ip ${ctx.ip}`
	});
	return { user, created: true, linked: false };
}
