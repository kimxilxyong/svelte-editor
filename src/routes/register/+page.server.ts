/**
 * @fileoverview `/register` – self-registration with name, email and password.
 *
 * ## Policy
 * - Registration can be switched off by an administrator (`auth.allowRegistration`). The load
 *   function reports the state so the page can show "registration closed", and the action re-checks
 *   it: hiding the form is not enforcement.
 * - New accounts get the configured default role (`auth.defaultRole`, `guest` unless changed) –
 *   a visitor can never choose their own role.
 * - After a successful registration the user is signed in (`establishSession`) and redirected to
 *   `next`.
 *
 * ## Security decisions
 * - **Abuse limit:** at most 20 submissions per IP and hour (in memory). There is no email
 *   verification, so this is the only brake on mass sign-ups from one address.
 * - **Account enumeration:** sign-up has to tell the user that an email is taken (otherwise they
 *   could not fix the problem); this is the accepted trade-off of password registration without
 *   email delivery. The login form stays uniform.
 * - **Unverified email:** the address is stored unverified; OAuth auto-linking later resets the
 *   password of such accounts when the real owner proves the mailbox (see `flow.ts`).
 * - **Open redirect:** `next` goes through `postAuthTarget`.
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { recordAudit } from '../../lib/server/auth/audit.js';
import { AuthError } from '../../lib/server/auth/errors.js';
import { clientIp, establishSession } from '../../lib/server/auth/login.js';
import { getOAuthProviderStatus } from '../../lib/server/auth/oauth-config.js';
import { createRateLimiter } from '../../lib/server/auth/rate-limit.js';
import { postAuthTarget } from '../../lib/server/auth/redirects.js';
import { getRuntimeOAuthConfig } from '../../lib/server/auth/runtime-config.js';
import { getAuthSettings } from '../../lib/server/auth/settings.js';
import { parseSignupForm, type SignupFieldErrors } from '../../lib/server/auth/signup-form.js';
import { createUser } from '../../lib/server/auth/users.js';
import { getDatabase } from '../../lib/server/database/manager.js';

/** Registration attempts per IP and hour. */
const registerLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60_000 });

export const load: PageServerLoad = async ({ locals, url }) => {
	const next = postAuthTarget(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);

	const db = await getDatabase();
	const settings = await getAuthSettings(db);
	return {
		next,
		providers: getOAuthProviderStatus(getRuntimeOAuthConfig()),
		allowRegistration: settings.allowRegistration
	};
};

export const actions: Actions = {
	default: async (event) => {
		const db = await getDatabase();
		const settings = await getAuthSettings(db);
		if (!settings.allowRegistration) {
			return fail(403, { error: 'Registration is currently closed.' });
		}

		const form = await event.request.formData();
		const next = postAuthTarget(String(form.get('next') ?? ''));
		const parsed = parseSignupForm(form);
		if (!parsed.ok) {
			return fail(400, { values: parsed.values, errors: parsed.errors });
		}

		const ip = clientIp(event);
		const decision = registerLimiter.check(ip);
		if (!decision.allowed) {
			return fail(429, {
				values: { name: parsed.data.name, email: parsed.data.email },
				error: 'Too many registration attempts. Please try again later.'
			});
		}
		registerLimiter.fail(ip);

		try {
			const user = await createUser(db, {
				name: parsed.data.name,
				email: parsed.data.email,
				password: parsed.data.password,
				role: settings.defaultRole
			});
			await recordAudit(db, {
				actor: { id: user.id, label: user.email ?? user.name },
				action: 'register',
				target: user.email ?? user.name,
				detail: `password, ip ${ip}`
			});
			await establishSession(event, db, user.id);
		} catch (error) {
			if (error instanceof AuthError) {
				const values = { name: parsed.data.name, email: parsed.data.email };
				if (error.code === 'email_taken') {
					return fail(409, { values, errors: { email: error.message } as SignupFieldErrors });
				}
				if (error.code === 'weak_password') {
					return fail(400, { values, errors: { password: error.message } as SignupFieldErrors });
				}
				return fail(400, { values, error: error.message });
			}
			throw error;
		}
		redirect(303, next);
	}
};
