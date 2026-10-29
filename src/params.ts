/**
 * @fileoverview Route parameter matchers (SvelteKit 3: a single `src/params.ts` module).
 *
 * `oauthprovider` restricts `/auth/[provider=oauthprovider]` and its `/callback` to the supported
 * OAuth providers, so `/auth/wallet/*` and unknown names fall through to other routes or a 404.
 * Matchers also run in the browser, so this file must not import server-only modules; keep the
 * list in sync with `oauthProviderIds` in `src/lib/server/auth/oauth-config.ts`.
 */

import { defineParams } from '@sveltejs/kit/params';

const oauthProviders = ['github', 'google', 'linkedin'];

/** Matchers keyed by the name used in route folders (`[param=name]`). */
export const params = defineParams({
	/** Matches `github`, `google` or `linkedin`; anything else does not match. */
	oauthprovider: (param) => (oauthProviders.includes(param) ? param : undefined)
});
