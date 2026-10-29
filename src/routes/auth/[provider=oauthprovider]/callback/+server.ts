/**
 * @fileoverview `GET /auth/<provider>/callback` – finishes the OAuth flow.
 *
 * 1. Compare the `state` query parameter with the `oauth_state` cookie in constant time (CSRF /
 *    login-injection protection). Both temporary cookies are always deleted (single use).
 * 2. Exchange the `code` (with the PKCE verifier when present) for the user's profile.
 * 3. `signInWithProfile` finds, links or registers the account (policy lives in `flow.ts`).
 * 4. Start a session and redirect to the stored `next` path – or, in link mode, back to `/account`.
 *
 * Failures never expose provider details: the user is sent to `/login?error=<code>` (or
 * `/account?error=<code>` in link mode) with a stable `AuthError` code the pages translate.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AuthError } from '../../../../lib/server/auth/errors.js';
import { signInWithProfile } from '../../../../lib/server/auth/flow.js';
import { clientIp, establishSession, safeNext } from '../../../../lib/server/auth/login.js';
import { completeOAuth, statesMatch } from '../../../../lib/server/auth/oauth.js';
import { getRuntimeOAuthConfig } from '../../../../lib/server/auth/runtime-config.js';
import { getDatabase } from '../../../../lib/server/database/manager.js';

export const GET: RequestHandler = async (event) => {
	const { params, url, cookies, locals } = event;
	const provider = params.provider as 'github' | 'google' | 'linkedin';

	const expectedState = cookies.get('oauth_state');
	const codeVerifier = cookies.get('oauth_verifier') ?? null;
	const linkMode = cookies.get('oauth_link') === '1';
	const next = safeNext(cookies.get('oauth_next'));
	for (const name of ['oauth_state', 'oauth_verifier', 'oauth_link', 'oauth_next']) {
		cookies.delete(name, { path: '/auth' });
	}
	const failureTarget = linkMode ? '/account' : '/login';

	// The user clicked "Cancel" at the provider.
	if (url.searchParams.get('error')) redirect(303, `${failureTarget}?error=oauth_denied`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state || !expectedState || !statesMatch(state, expectedState)) {
		redirect(303, `${failureTarget}?error=oauth_failed`);
	}
	const config = getRuntimeOAuthConfig();
	if (!config[provider]) redirect(303, '/login?error=oauth_unconfigured');
	// Link mode is only honoured while the user is (still) signed in.
	if (linkMode && !locals.user) redirect(303, '/login?error=oauth_failed');

	let destination: string;
	try {
		const db = await getDatabase();
		const profile = await completeOAuth(
			provider,
			config,
			`${url.origin}/auth/${provider}/callback`,
			{
				code,
				codeVerifier
			}
		);
		const result = await signInWithProfile(db, profile, {
			ip: clientIp(event),
			linkToUserId: linkMode ? locals.user?.id : undefined
		});
		if (linkMode) {
			// Already signed in: keep the current session and just report the result.
			destination = `/account?linked=${provider}`;
		} else {
			await establishSession(event, db, result.user.id);
			destination = next;
		}
	} catch (error) {
		if (error instanceof AuthError) {
			redirect(303, `${failureTarget}?error=${error.code}`);
		}
		console.error(`OAuth callback for ${provider} failed.`, error);
		redirect(303, `${failureTarget}?error=oauth_failed`);
	}
	redirect(303, destination);
};
