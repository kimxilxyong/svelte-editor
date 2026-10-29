/**
 * @fileoverview `GET /auth/<provider>` – starts the OAuth 2.0 authorization-code flow.
 *
 * Generates `state` (and a PKCE verifier where supported), stores them in short-lived HttpOnly
 * cookies scoped to `/auth`, and redirects the browser to the provider. Optional query parameters:
 * - `next` – same-site path to open after sign-in (validated with `safeNext`).
 * - `link=1` – a signed-in user wants to *add* this provider to their account.
 *
 * The cookies are `SameSite=Lax`: they are still sent when the provider redirects back with a
 * top-level GET navigation, but not on cross-site sub-requests.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { safeNext } from '../../../lib/server/auth/login.js';
import { beginOAuth } from '../../../lib/server/auth/oauth.js';
import { getRuntimeOAuthConfig } from '../../../lib/server/auth/runtime-config.js';

/** Lifetime of the temporary OAuth cookies, in seconds. */
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

export const GET: RequestHandler = ({ params, url, cookies, locals }) => {
	const provider = params.provider as 'github' | 'google' | 'linkedin';
	const config = getRuntimeOAuthConfig();
	if (!config[provider]) {
		redirect(303, '/login?error=oauth_unconfigured');
	}

	const redirectUri = `${url.origin}/auth/${provider}/callback`;
	const { url: authorizeUrl, state, codeVerifier } = beginOAuth(provider, config, redirectUri);

	const options = {
		path: '/auth',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge: OAUTH_COOKIE_MAX_AGE
	};
	cookies.set('oauth_state', state, options);
	if (codeVerifier) cookies.set('oauth_verifier', codeVerifier, options);
	else cookies.delete('oauth_verifier', { path: '/auth' });
	// Linking only makes sense (and is only honoured at the callback) for a signed-in user.
	if (url.searchParams.get('link') === '1' && locals.user) cookies.set('oauth_link', '1', options);
	else cookies.delete('oauth_link', { path: '/auth' });
	cookies.set('oauth_next', safeNext(url.searchParams.get('next')), options);

	redirect(302, authorizeUrl.toString(), { external: [authorizeUrl.origin] });
};
