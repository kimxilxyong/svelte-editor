/**
 * @fileoverview OAuth authorization-code flow and trusted external-profile mapping.
 *
 * Arctic generates provider authorization URLs and Google PKCE challenges. Token/profile requests use
 * an injectable Fetch implementation so network boundaries are testable; OAuth credentials and token
 * exchanges remain server-side, and email-verification state is preserved in normalized profiles.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
	decodeIdToken,
	GitHub,
	Google,
	LinkedIn,
	generateCodeVerifier,
	generateState
} from 'arctic';
import { AuthError } from './errors.js';
import type { OAuthConfig, OAuthProviderId } from './oauth-config.js';

/** Profile information normalized across the supported identity providers. */
export type OAuthProfile = {
	provider: OAuthProviderId;
	providerUserId: string;
	email: string | null;
	emailVerified: boolean;
	name: string;
	label: string;
};

/** OAuth authorization URL and short-lived callback state material. */
export type OAuthAuthorization = {
	url: URL;
	state: string;
	/** Google PKCE verifier; `null` for providers without PKCE in this implementation. */
	codeVerifier: string | null;
};

/** Authorization code material returned by a provider callback. */
export type OAuthCompletionInput = {
	code: string;
	codeVerifier: string | null;
};

type JsonObject = Record<string, unknown>;
type FetchImplementation = typeof fetch;

/**
 * Creates a provider authorization URL and the state/PKCE values for the callback.
 *
 * @param provider - Supported OAuth provider.
 * @param config - Provider credentials; an unconfigured provider fails closed.
 * @param redirectUri - Exact callback URI registered with the provider.
 * @returns Provider authorization URL, opaque state, and optional PKCE verifier.
 * @throws {@link AuthError} with `oauth_failed` when the provider is not configured.
 * @example
 * const { url, state, codeVerifier } = beginOAuth('google', config, 'https://app.test/auth/google/callback');
 */
export function beginOAuth(
	provider: OAuthProviderId,
	config: OAuthConfig,
	redirectUri: string
): OAuthAuthorization {
	const credentials = config[provider];
	if (!credentials?.clientId || !credentials.clientSecret) throw oauthFailed();
	const state = generateState();

	switch (provider) {
		case 'github':
			return {
				url: new GitHub(
					credentials.clientId,
					credentials.clientSecret,
					redirectUri
				).createAuthorizationURL(state, ['user:email']),
				state,
				codeVerifier: null
			};
		case 'google': {
			const codeVerifier = generateCodeVerifier();
			return {
				url: new Google(
					credentials.clientId,
					credentials.clientSecret,
					redirectUri
				).createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']),
				state,
				codeVerifier
			};
		}
		case 'linkedin':
			return {
				url: new LinkedIn(
					credentials.clientId,
					credentials.clientSecret,
					redirectUri
				).createAuthorizationURL(state, ['openid', 'profile', 'email']),
				state,
				codeVerifier: null
			};
	}
}

/**
 * Exchanges a provider authorization code and maps its profile into the common shape.
 *
 * @param provider - Supported OAuth provider.
 * @param config - Server-only provider credentials.
 * @param redirectUri - Same callback URI used when authorization began.
 * @param input - Callback code and Google PKCE verifier.
 * @param fetchImpl - Injectable Fetch implementation (defaults to global `fetch`).
 * @returns Normalized identity profile; unverified email addresses are never treated as verified.
 * @throws {@link AuthError} with `oauth_failed` for token, profile, or claims failures.
 * @example
 * const profile = await completeOAuth('github', config, callbackUrl, { code, codeVerifier: null });
 */
export async function completeOAuth(
	provider: OAuthProviderId,
	config: OAuthConfig,
	redirectUri: string,
	input: OAuthCompletionInput,
	fetchImpl: FetchImplementation = fetch
): Promise<OAuthProfile> {
	const credentials = config[provider];
	if (!credentials?.clientId || !credentials.clientSecret || !input.code) throw oauthFailed();
	if (provider === 'google' && !input.codeVerifier) throw oauthFailed();

	const token = await exchangeCode(provider, credentials, redirectUri, input, fetchImpl);
	const accessToken = nonEmptyString(token.access_token);
	if (!accessToken) throw oauthFailed();

	if (provider === 'github') return getGitHubProfile(accessToken, fetchImpl);
	if (provider === 'google') return getGoogleProfile(token.id_token, credentials.clientId);
	return getLinkedInProfile(accessToken, fetchImpl);
}

/**
 * Compares OAuth states without revealing the first differing byte through timing.
 *
 * Hashing both inputs first ensures the fixed-length timing-safe comparison also handles unequal input
 * lengths without taking an early length-mismatch branch.
 *
 * @param actual - State supplied by the provider callback.
 * @param expected - State stored in the short-lived HttpOnly cookie.
 * @returns Whether both state values are byte-for-byte identical.
 */
export function statesMatch(actual: string, expected: string): boolean {
	const actualHash = createHash('sha256').update(actual).digest();
	const expectedHash = createHash('sha256').update(expected).digest();
	return timingSafeEqual(actualHash, expectedHash);
}

async function exchangeCode(
	provider: OAuthProviderId,
	credentials: { clientId: string; clientSecret: string },
	redirectUri: string,
	input: OAuthCompletionInput,
	fetchImpl: FetchImplementation
): Promise<JsonObject> {
	const tokenUrl = {
		github: 'https://github.com/login/oauth/access_token',
		google: 'https://oauth2.googleapis.com/token',
		linkedin: 'https://www.linkedin.com/oauth/v2/accessToken'
	}[provider];
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code: input.code,
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		redirect_uri: redirectUri
	});
	if (provider === 'google') body.set('code_verifier', input.codeVerifier ?? '');

	const payload = await requestJson(fetchImpl, tokenUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});
	if (!isJsonObject(payload)) throw oauthFailed();
	return payload;
}

async function getGitHubProfile(
	accessToken: string,
	fetchImpl: FetchImplementation
): Promise<OAuthProfile> {
	const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };
	const userPayload = await requestJson(fetchImpl, 'https://api.github.com/user', { headers });
	const emailsPayload = await requestJson(fetchImpl, 'https://api.github.com/user/emails', {
		headers
	});
	if (!isJsonObject(userPayload) || !Array.isArray(emailsPayload)) throw oauthFailed();
	const user = userPayload;
	const emails = emailsPayload;

	const usableEmails = emails.filter(
		(email): email is JsonObject =>
			isJsonObject(email) && typeof email.email === 'string' && email.verified === true
	);
	const selectedEmail = usableEmails.find((email) => email.primary === true) ?? usableEmails[0];
	const providerUserId = typeof user.id === 'number' ? String(user.id) : nonEmptyString(user.id);
	const login = nonEmptyString(user.login);
	if (!providerUserId || !login) throw oauthFailed();

	return {
		provider: 'github',
		providerUserId,
		email: normalizeProviderEmail(selectedEmail?.email),
		emailVerified: Boolean(selectedEmail),
		name: nonEmptyString(user.name) ?? login,
		label: login
	};
}

function getGoogleProfile(idToken: unknown, clientId: string): OAuthProfile {
	if (typeof idToken !== 'string' || !idToken) throw oauthFailed();
	let claims: JsonObject;
	try {
		claims = decodeIdToken(idToken) as JsonObject;
	} catch {
		throw oauthFailed();
	}

	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	const issuer = claims.iss;
	const expiresAt = claims.exp;
	const providerUserId = nonEmptyString(claims.sub);
	// The ID token is taken only from Google's server-to-server code-exchange response, not browser input.
	// Still check the OIDC issuer, audience and lifetime before using its identity claims.
	if (
		!providerUserId ||
		!audiences.includes(clientId) ||
		(issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') ||
		typeof expiresAt !== 'number' ||
		expiresAt * 1000 <= Date.now()
	) {
		throw oauthFailed();
	}
	const email = normalizeProviderEmail(claims.email);
	const emailVerified = claims.email_verified === true;
	const displayName = nonEmptyString(claims.name);
	const label = email ?? providerUserId;
	return {
		provider: 'google',
		providerUserId,
		email,
		emailVerified,
		name: displayName ?? (email ? email.split('@')[0] : 'Google user'),
		label
	};
}

async function getLinkedInProfile(
	accessToken: string,
	fetchImpl: FetchImplementation
): Promise<OAuthProfile> {
	const profilePayload = await requestJson(fetchImpl, 'https://api.linkedin.com/v2/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
	});
	if (!isJsonObject(profilePayload)) throw oauthFailed();
	const profile = profilePayload;
	const providerUserId = nonEmptyString(profile.sub);
	const email = normalizeProviderEmail(profile.email);
	if (!providerUserId) throw oauthFailed();

	const fullName = nonEmptyString(profile.name);
	const composedName = [nonEmptyString(profile.given_name), nonEmptyString(profile.family_name)]
		.filter(Boolean)
		.join(' ');
	return {
		provider: 'linkedin',
		providerUserId,
		email,
		emailVerified: profile.email_verified === true,
		name: fullName ?? composedName ?? (email ? email.split('@')[0] : 'LinkedIn user'),
		label: email ?? providerUserId
	};
}

async function requestJson(
	fetchImpl: FetchImplementation,
	url: string,
	init?: RequestInit
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetchImpl(url, init);
	} catch {
		throw oauthFailed();
	}
	if (!response.ok) throw oauthFailed();
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw oauthFailed();
	}
	if (!isJsonObject(payload) && !Array.isArray(payload)) throw oauthFailed();
	if (isJsonObject(payload) && typeof payload.error === 'string') throw oauthFailed();
	return payload;
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeProviderEmail(value: unknown): string | null {
	const email = nonEmptyString(value);
	return email ? email.toLowerCase() : null;
}

function oauthFailed(): AuthError {
	return new AuthError('oauth_failed', 'Unable to complete sign-in with this provider.');
}
