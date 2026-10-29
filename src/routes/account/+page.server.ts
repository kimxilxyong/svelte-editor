/**
 * @fileoverview `/account` – the signed-in user's own profile, password and sign-in methods.
 *
 * Reachable for every signed-in role (`guest` and above, see `accessRules`); the hook has already
 * guaranteed `locals.user`, the load function still guards against a user deleted mid-session.
 *
 * ## Actions
 * | action     | what it does                                                                    |
 * | ---------- | ------------------------------------------------------------------------------- |
 * | `profile`  | changes the display name (email is read-only, see below)                        |
 * | `password` | changes (or first sets) the password, revokes all *other* sessions, audits it   |
 * | `unlink`   | removes one linked identity (never the last sign-in method)                     |
 *
 * Every result carries a `section` key so the page can show the message next to the right form.
 *
 * ## Security decisions
 * - **Re-authentication:** changing an existing password requires the current one, verified through
 *   `verifyCredentials`, i.e. with the same brute-force rate limit as the login form. A stolen
 *   session alone is therefore not enough to take over the account permanently.
 * - **Session revocation:** after a password change every session except the current one is deleted,
 *   so a possible attacker's session dies together with the old password.
 * - **Email is read-only** here: changing it would create an unverified address that could later be
 *   used to hijack OAuth auto-linking. Accounts *without* an email (wallet / some OAuth sign-ups)
 *   may add one while setting their first password, because a password account needs an email; the
 *   address is stored unverified (`updateUser` handles that).
 * - **No secrets in results:** `fail()` payloads contain messages only, never passwords.
 * - **Audit:** `password_change` is recorded here (identity link/unlink are audited by the service).
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authErrorMessage } from '../../lib/auth/messages.js';
import { normalizeEmail, validateName, validatePassword } from '../../lib/auth/validation.js';
import { recordAudit } from '../../lib/server/auth/audit.js';
import { AuthError } from '../../lib/server/auth/errors.js';
import { clientIp } from '../../lib/server/auth/login.js';
import { getOAuthProviderStatus } from '../../lib/server/auth/oauth-config.js';
import { getRuntimeOAuthConfig } from '../../lib/server/auth/runtime-config.js';
import {
	getUserById,
	removeIdentity,
	setUserPassword,
	updateUser,
	verifyCredentials
} from '../../lib/server/auth/users.js';
import { getDatabase } from '../../lib/server/database/manager.js';

/** Provider ids that `?linked=` may carry (anything else is ignored, never rendered). */
const linkedProviders = ['github', 'google', 'linkedin'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login?next=%2Faccount');
	const db = await getDatabase();
	const account = await getUserById(db, locals.user.id);
	if (!account) redirect(303, '/login');

	const linked = url.searchParams.get('linked');
	return {
		account,
		providers: getOAuthProviderStatus(getRuntimeOAuthConfig()),
		error: authErrorMessage(url.searchParams.get('error')),
		linked: (linkedProviders as readonly string[]).includes(linked ?? '') ? linked : null
	};
};

export const actions: Actions = {
	profile: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const name = validateName(form.get('name'));
		if (!name) {
			return fail(400, {
				section: 'profile' as const,
				error: 'Enter a name (1–80 characters).',
				name: String(form.get('name') ?? '').slice(0, 200)
			});
		}
		try {
			const db = await getDatabase();
			// Only the name is patched: role / disabled / email can never be changed from here,
			// whatever extra fields a hostile client posts.
			await updateUser(db, locals.user.id, { name }, locals.user.id);
		} catch (error) {
			if (error instanceof AuthError) {
				return fail(400, { section: 'profile' as const, error: error.message, name });
			}
			throw error;
		}
		return { section: 'profile' as const, success: 'Profile saved.' };
	},

	password: async (event) => {
		const { request, locals } = event;
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const current = String(form.get('current') ?? '');
		const next = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const failure = (status: number, error: string) =>
			fail(status, { section: 'password' as const, error });

		const db = await getDatabase();
		const account = await getUserById(db, locals.user.id);
		if (!account) redirect(303, '/login');

		// A password account needs an email; email-less accounts may supply one here.
		let email = account.email;
		const newEmail = email ? null : normalizeEmail(form.get('email'));
		if (!email) {
			if (!newEmail) return failure(400, 'Enter a valid email address to use with your password.');
			email = newEmail;
		}

		const problem = validatePassword(next, { email, name: account.name });
		if (problem) return failure(400, problem);
		if (next !== confirm) return failure(400, 'The new passwords do not match.');

		try {
			if (account.hasPassword) {
				// Re-authenticate with the current password (rate limited like the login form).
				try {
					await verifyCredentials(db, email, current, { ip: clientIp(event) });
				} catch (error) {
					if (error instanceof AuthError && error.code === 'invalid_credentials') {
						return failure(400, 'The current password is incorrect.');
					}
					throw error;
				}
			}
			if (newEmail) await updateUser(db, account.id, { email: newEmail }, account.id);
			await setUserPassword(db, account.id, next, {
				revokeSessions: true,
				exceptSessionId: locals.sessionId ?? undefined
			});
			await recordAudit(db, {
				actor: { id: account.id, label: account.email ?? newEmail ?? account.name },
				action: 'password_change',
				target: account.email ?? newEmail ?? account.name,
				detail: account.hasPassword ? 'changed' : 'set'
			});
		} catch (error) {
			if (error instanceof AuthError) {
				return failure(error.code === 'rate_limited' ? 429 : 400, error.message);
			}
			throw error;
		}
		return {
			section: 'password' as const,
			success: 'Password updated. All other devices have been signed out.'
		};
	},

	unlink: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const identityId = String(form.get('identityId') ?? '');
		try {
			const db = await getDatabase();
			// `removeIdentity` scopes the delete to this user, so a forged id of somebody else's
			// identity is simply "not found", and it refuses to remove the last sign-in method.
			await removeIdentity(db, locals.user.id, identityId);
		} catch (error) {
			if (error instanceof AuthError) {
				return fail(400, { section: 'unlink' as const, error: error.message, code: error.code });
			}
			throw error;
		}
		return { section: 'unlink' as const, success: 'Sign-in method removed.' };
	}
};
