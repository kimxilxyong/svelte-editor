/**
 * @fileoverview Declares optional runtime environment variables used by SvelteKit server code.
 *
 * Private OAuth values are server-only and remain optional so the application can run with only
 * password or wallet authentication enabled.
 */

import { defineEnvVars } from '@sveltejs/kit/env';

/** Schema for optional variables: unset or blank values become `undefined` instead of failing startup. */
const optional = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** Declared environment variables, including optional server-only OAuth credentials. */
export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The database connection string.' },
	GITHUB_CLIENT_ID: {
		description: 'Optional GitHub OAuth application client ID.',
		schema: optional
	},
	GITHUB_CLIENT_SECRET: {
		description: 'Optional GitHub OAuth application client secret.',
		schema: optional
	},
	GOOGLE_CLIENT_ID: {
		description: 'Optional Google OAuth application client ID.',
		schema: optional
	},
	GOOGLE_CLIENT_SECRET: {
		description: 'Optional Google OAuth application client secret.',
		schema: optional
	},
	LINKEDIN_CLIENT_ID: {
		description: 'Optional LinkedIn OAuth application client ID.',
		schema: optional
	},
	LINKEDIN_CLIENT_SECRET: {
		description: 'Optional LinkedIn OAuth application client secret.',
		schema: optional
	}
});
