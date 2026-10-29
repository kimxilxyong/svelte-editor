/**
 * @fileoverview Server-side OAuth provider configuration and public provider status.
 *
 * Client IDs and secrets are read only by server authentication code. The optional environment
 * argument keeps this module usable in plain Node/Vitest while allowing a SvelteKit server entrypoint
 * to inject values imported from `$app/env/private` where needed.
 */

/** OAuth providers supported by the authentication flow. */
export const oauthProviderIds = ['github', 'google', 'linkedin'] as const;

/** Provider identifier accepted by OAuth services and routes. */
export type OAuthProviderId = (typeof oauthProviderIds)[number];

/** OAuth client credentials keyed by provider. Only fully configured providers are included. */
export type OAuthConfig = Partial<
	Record<OAuthProviderId, { clientId: string; clientSecret: string }>
>;

/** Environment variables that may provide OAuth credentials. */
export type OAuthEnvironment = Partial<Record<string, string | undefined>>;

/** Safe provider availability information suitable for rendering in the browser. */
export type OAuthProviderStatus = {
	id: OAuthProviderId;
	label: string;
	configured: boolean;
};

const providerEnvironmentKeys: Record<
	OAuthProviderId,
	{ clientId: string; clientSecret: string; label: string }
> = {
	github: {
		clientId: 'GITHUB_CLIENT_ID',
		clientSecret: 'GITHUB_CLIENT_SECRET',
		label: 'GitHub'
	},
	google: {
		clientId: 'GOOGLE_CLIENT_ID',
		clientSecret: 'GOOGLE_CLIENT_SECRET',
		label: 'Google'
	},
	linkedin: {
		clientId: 'LINKEDIN_CLIENT_ID',
		clientSecret: 'LINKEDIN_CLIENT_SECRET',
		label: 'LinkedIn'
	}
};

/**
 * Checks whether a value is one of the supported OAuth provider identifiers.
 *
 * @param value - Untrusted route or form value.
 * @returns `true` when the value is a supported provider ID.
 * @example
 * isOAuthProviderId('google'); // true
 */
export function isOAuthProviderId(value: unknown): value is OAuthProviderId {
	return typeof value === 'string' && (oauthProviderIds as readonly string[]).includes(value);
}

/**
 * Reads configured OAuth client credentials from an environment-like object.
 *
 * A provider is enabled only when both values are non-empty. In SvelteKit server code, pass the
 * private values imported from `$app/env/private`; plain Node and Vitest default to `process.env`.
 *
 * @param environment - Optional source for the six private OAuth variables.
 * @returns Credentials for configured providers only; no secrets are exposed by status helpers.
 * @example
 * const config = getOAuthConfig({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
 */
export function getOAuthConfig(environment: OAuthEnvironment = process.env): OAuthConfig {
	const config: OAuthConfig = {};
	for (const id of oauthProviderIds) {
		const keys = providerEnvironmentKeys[id];
		const clientId = environment[keys.clientId]?.trim();
		const clientSecret = environment[keys.clientSecret]?.trim();
		if (clientId && clientSecret) config[id] = { clientId, clientSecret };
	}
	return config;
}

/**
 * Lists every OAuth provider in display order without returning its credentials.
 *
 * @param config - OAuth configuration returned by {@link getOAuthConfig} or a test fixture.
 * @returns Provider IDs, display labels, and whether both credentials are configured.
 */
export function getOAuthProviderStatus(config: OAuthConfig): OAuthProviderStatus[] {
	return oauthProviderIds.map((id) => ({
		id,
		label: providerEnvironmentKeys[id].label,
		configured: Boolean(config[id]?.clientId && config[id]?.clientSecret)
	}));
}
