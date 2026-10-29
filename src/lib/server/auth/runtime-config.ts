/**
 * @fileoverview Bridges SvelteKit's validated private environment (`$app/env/private`) to the
 * framework-agnostic auth modules.
 *
 * `oauth-config.ts` deliberately defaults to `process.env` so it stays testable in plain Vitest, but
 * values from a local `.env` file are only visible through `$app/env/private` during development.
 * Route handlers must therefore call {@link getRuntimeOAuthConfig} instead of `getOAuthConfig()`.
 */

import * as privateEnv from '$app/env/private';
import { getOAuthConfig, type OAuthConfig } from './oauth-config.js';

/**
 * Reads the OAuth client credentials from the SvelteKit private environment.
 * @returns Only the providers whose client id and secret are both configured.
 */
export function getRuntimeOAuthConfig(): OAuthConfig {
	return getOAuthConfig(privateEnv as unknown as Record<string, string | undefined>);
}
