/**
 * @fileoverview `/login` – email + password sign-in form action and page data.
 *
 * ## Load
 * Signed-in users are redirected away (to `?next=` or `/`). Anonymous visitors receive the OAuth
 * provider availability, whether registration is open, the validated `next` target and the message
 * for an `?error=<code>` produced by the OAuth callback / start endpoints.
 *
 * ## Action `default`
 * 1. `verifyCredentials` performs the rate-limited check (5 failures / 15 min per IP+email).
 * 2. `establishSession` revokes any previous session (session-fixation defence) and sets the cookie.
 * 3. The browser is redirected to `postAuthTarget(next)`.
 *
 * ### Security decisions
 * - **Error uniformity / account enumeration:** unknown email and wrong password both surface the
 *   single message "Invalid email or password" (the service guarantees comparable timing too).
 *   Only after a *correct* password does the page reveal that an account is disabled.
 * - **No credential echo:** a failed attempt returns the typed email so the field stays filled, but
 *   never the password.
 * - **Open redirect:** `next` is untrusted (query string and hidden field). It is passed through
 *   `postAuthTarget`, which only accepts same-site paths and never an anonymous-only page.
 * - **CSRF:** SvelteKit's built-in origin check for form posts plus the hook's origin check.
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authErrorMessage } from '../../lib/auth/messages.js';
import { AuthError } from '../../lib/server/auth/errors.js';
import { clientIp, establishSession } from '../../lib/server/auth/login.js';
import { getOAuthProviderStatus } from '../../lib/server/auth/oauth-config.js';
import { postAuthTarget } from '../../lib/server/auth/redirects.js';
import { getRuntimeOAuthConfig } from '../../lib/server/auth/runtime-config.js';
import { getAuthSettings } from '../../lib/server/auth/settings.js';
import { verifyCredentials } from '../../lib/server/auth/users.js';
import { getDatabase } from '../../lib/server/database/manager.js';

/** HTTP status for the {@link AuthError} codes `verifyCredentials` can throw. */
const statusFor = { rate_limited: 429, account_disabled: 403 } as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	const next = postAuthTarget(url.searchParams.get('next'));
	// Already signed in: nothing to do here.
	if (locals.user) redirect(303, next);

	const db = await getDatabase();
	const settings = await getAuthSettings(db);
	return {
		next,
		providers: getOAuthProviderStatus(getRuntimeOAuthConfig()),
		allowRegistration: settings.allowRegistration,
		error: authErrorMessage(url.searchParams.get('error'))
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const next = postAuthTarget(String(form.get('next') ?? ''));

		if (!email || !password) {
			return fail(400, { email, error: 'Enter your email and password.' });
		}

		try {
			const db = await getDatabase();
			const user = await verifyCredentials(db, email, password, { ip: clientIp(event) });
			await establishSession(event, db, user.id);
		} catch (error) {
			if (error instanceof AuthError) {
				const status = statusFor[error.code as keyof typeof statusFor] ?? 400;
				return fail(status, { email, error: error.message });
			}
			throw error;
		}
		redirect(303, next);
	}
};
