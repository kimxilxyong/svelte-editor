// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from './lib/auth/types.js';
import type { ProjectSummary } from './lib/projects.js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Signed-in user of the current request, resolved from the session cookie by `hooks.server.ts`. */
			user: SessionUser | null;
			/** `sha256(token)` of the current session (the `sessions.id` primary key), or `null`. */
			sessionId: string | null;
			/** Project the signed-in user is working on (owned by them, or any for admins); `null` when none. */
			project: ProjectSummary | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
