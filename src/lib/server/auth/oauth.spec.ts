/**
 * @fileoverview OAuth provider URL, PKCE, configuration, and profile-mapping tests.
 *
 * All network traffic is represented by an injected fake Fetch implementation, ensuring tests never
 * contact provider endpoints and verifying that untrusted/unverified profile fields are handled safely.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AuthError } from './errors.js';
import { completeOAuth, beginOAuth, statesMatch } from './oauth.js';
import {
	getOAuthConfig,
	getOAuthProviderStatus,
	isOAuthProviderId,
	type OAuthConfig
} from './oauth-config.js';

const redirectUri = 'https://app.example.test/auth/callback';
const config: OAuthConfig = {
	github: { clientId: 'github-id', clientSecret: 'github-secret' },
	google: { clientId: 'google-id', clientSecret: 'google-secret' },
	linkedin: { clientId: 'linkedin-id', clientSecret: 'linkedin-secret' }
};

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function fakeFetch(
	respond: (url: string, init?: RequestInit) => Response | Promise<Response>
): typeof fetch {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
		respond(String(input), init)
	) as unknown as typeof fetch;
}

function googleIdToken(claims: Record<string, unknown>): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function validGoogleClaims(overrides: Record<string, unknown> = {}) {
	return {
		sub: 'google-subject-123',
		aud: 'google-id',
		iss: 'https://accounts.google.com',
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: 'Member@Example.test',
		email_verified: true,
		name: 'Google Member',
		...overrides
	};
}

describe('OAuth provider configuration', () => {
	it('reads optional credentials and only enables fully configured providers', () => {
		const actual = getOAuthConfig({
			GITHUB_CLIENT_ID: ' github-id ',
			GITHUB_CLIENT_SECRET: 'github-secret',
			GOOGLE_CLIENT_ID: 'google-id',
			LINKEDIN_CLIENT_ID: 'linkedin-id',
			LINKEDIN_CLIENT_SECRET: 'linkedin-secret'
		});
		expect(actual).toEqual({
			github: { clientId: 'github-id', clientSecret: 'github-secret' },
			linkedin: { clientId: 'linkedin-id', clientSecret: 'linkedin-secret' }
		});
		expect(getOAuthProviderStatus(actual)).toEqual([
			{ id: 'github', label: 'GitHub', configured: true },
			{ id: 'google', label: 'Google', configured: false },
			{ id: 'linkedin', label: 'LinkedIn', configured: true }
		]);
		expect(isOAuthProviderId('google')).toBe(true);
		expect(isOAuthProviderId('wallet')).toBe(false);
	});

	it('falls back to process.env when no SvelteKit environment is injected', () => {
		vi.stubEnv('GITHUB_CLIENT_ID', 'vitest-client');
		vi.stubEnv('GITHUB_CLIENT_SECRET', 'vitest-secret');
		try {
			expect(getOAuthConfig().github).toEqual({
				clientId: 'vitest-client',
				clientSecret: 'vitest-secret'
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe('beginOAuth', () => {
	it.each([
		['github', 'user:email'],
		['google', 'openid profile email'],
		['linkedin', 'openid profile email']
	] as const)('generates the %s URL and requested scopes', (provider, expectedScopes) => {
		const result = beginOAuth(provider, config, redirectUri);
		expect(result.url.searchParams.get('client_id')).toBe(config[provider]?.clientId);
		expect(result.url.searchParams.get('redirect_uri')).toBe(redirectUri);
		expect(result.url.searchParams.get('response_type')).toBe('code');
		expect(result.url.searchParams.get('scope')).toBe(expectedScopes);
		expect(result.state.length).toBeGreaterThan(10);

		if (provider === 'google') {
			expect(result.codeVerifier).toBeTruthy();
			expect(result.url.searchParams.get('code_challenge_method')).toBe('S256');
			expect(result.url.searchParams.get('code_challenge')).toBe(
				createHash('sha256').update(result.codeVerifier!).digest('base64url')
			);
		} else {
			expect(result.codeVerifier).toBeNull();
		}
	});

	it('fails closed when provider credentials are absent', () => {
		expect(() => beginOAuth('github', {}, redirectUri)).toThrowError(
			expect.objectContaining({ code: 'oauth_failed' })
		);
	});
});

describe('completeOAuth', () => {
	it('maps GitHub profile and chooses the primary verified email', async () => {
		const fetchImpl = fakeFetch((url) => {
			if (url.endsWith('/access_token')) return jsonResponse({ access_token: 'github-token' });
			if (url.endsWith('/user'))
				return jsonResponse({ id: 42, login: 'sample-user', name: 'Sample User' });
			if (url.endsWith('/user/emails')) {
				return jsonResponse([
					{ email: 'other@example.test', primary: false, verified: true },
					{ email: 'unverified@example.test', primary: true, verified: false },
					{ email: 'PRIMARY@Example.test', primary: true, verified: true }
				]);
			}
			return jsonResponse({}, 404);
		});

		const profile = await completeOAuth(
			'github',
			config,
			redirectUri,
			{ code: 'code', codeVerifier: null },
			fetchImpl
		);
		expect(profile).toEqual({
			provider: 'github',
			providerUserId: '42',
			email: 'primary@example.test',
			emailVerified: true,
			name: 'Sample User',
			label: 'sample-user'
		});
	});

	it('does not trust GitHub email entries that are all unverified', async () => {
		const fetchImpl = fakeFetch((url) => {
			if (url.endsWith('/access_token')) return jsonResponse({ access_token: 'github-token' });
			if (url.endsWith('/user')) return jsonResponse({ id: 7, login: 'octocat' });
			return jsonResponse([{ email: 'attacker@example.test', primary: true, verified: false }]);
		});
		const profile = await completeOAuth(
			'github',
			config,
			redirectUri,
			{ code: 'code', codeVerifier: null },
			fetchImpl
		);
		expect(profile.email).toBeNull();
		expect(profile.emailVerified).toBe(false);
		expect(profile.name).toBe('octocat');
	});

	it('maps Google ID-token claims and preserves an explicitly unverified email as unverified', async () => {
		const fetchImpl = fakeFetch(() =>
			jsonResponse({
				access_token: 'google-token',
				id_token: googleIdToken(validGoogleClaims({ email_verified: false }))
			})
		);
		const profile = await completeOAuth(
			'google',
			config,
			redirectUri,
			{ code: 'code', codeVerifier: 'verifier' },
			fetchImpl
		);
		expect(profile).toEqual({
			provider: 'google',
			providerUserId: 'google-subject-123',
			email: 'member@example.test',
			emailVerified: false,
			name: 'Google Member',
			label: 'member@example.test'
		});
		expect(new URL(String(vi.mocked(fetchImpl).mock.calls[0][0])).origin).toBe(
			'https://oauth2.googleapis.com'
		);
	});

	it('maps LinkedIn userinfo claims and keeps an unverified email unverified', async () => {
		const fetchImpl = fakeFetch((url) => {
			if (url.includes('/accessToken')) return jsonResponse({ access_token: 'linkedin-token' });
			return jsonResponse({
				sub: 'linkedin-subject',
				email: 'Member@Example.test',
				email_verified: false,
				given_name: 'Linked',
				family_name: 'Member'
			});
		});
		const profile = await completeOAuth(
			'linkedin',
			config,
			redirectUri,
			{ code: 'code', codeVerifier: null },
			fetchImpl
		);
		expect(profile).toEqual({
			provider: 'linkedin',
			providerUserId: 'linkedin-subject',
			email: 'member@example.test',
			emailVerified: false,
			name: 'Linked Member',
			label: 'member@example.test'
		});
	});

	it('rejects invalid Google audience or expired ID-token claims', async () => {
		for (const claims of [
			validGoogleClaims({ aud: 'another-client' }),
			validGoogleClaims({ exp: Math.floor(Date.now() / 1000) - 60 })
		]) {
			const fetchImpl = fakeFetch(() =>
				jsonResponse({ access_token: 'google-token', id_token: googleIdToken(claims) })
			);
			await expect(
				completeOAuth(
					'google',
					config,
					redirectUri,
					{ code: 'code', codeVerifier: 'verifier' },
					fetchImpl
				)
			).rejects.toMatchObject({ code: 'oauth_failed' });
		}
	});

	it('converts token, profile, and missing-PKCE failures into safe auth errors', async () => {
		await expect(
			completeOAuth(
				'google',
				config,
				redirectUri,
				{ code: 'code', codeVerifier: null },
				fakeFetch(() => jsonResponse({}))
			)
		).rejects.toMatchObject({ code: 'oauth_failed' });
		await expect(
			completeOAuth(
				'github',
				config,
				redirectUri,
				{ code: 'code', codeVerifier: null },
				fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400))
			)
		).rejects.toBeInstanceOf(AuthError);
		await expect(
			completeOAuth(
				'linkedin',
				config,
				redirectUri,
				{ code: 'code', codeVerifier: null },
				fakeFetch((url) =>
					url.includes('/accessToken')
						? jsonResponse({ access_token: 'token' })
						: jsonResponse({ sub: '' })
				)
			)
		).rejects.toMatchObject({ code: 'oauth_failed' });
	});
});

describe('OAuth state comparison', () => {
	it('matches only identical state values', () => {
		expect(statesMatch('same-state', 'same-state')).toBe(true);
		expect(statesMatch('same-state', 'different-state')).toBe(false);
		expect(statesMatch('short', 'shorter')).toBe(false);
	});
});
