/**
 * @fileoverview Small helpers for `+page.server.ts` / `+server.ts` / remote functions that need a
 * signed-in user or a minimum role *in addition* to the central policy in `hooks.server.ts`.
 *
 * The hook already rejects anonymous / under-privileged requests per route, so these are
 * defence-in-depth and also narrow the type of `locals.user` to non-null.
 */

import { error, redirect } from '@sveltejs/kit';
import { hasRole, type Role } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/types.js';

/** The part of `event.locals` the guards need. */
type GuardLocals = { user?: SessionUser | null };

/**
 * Requires a signed-in user.
 * @param locals - `event.locals`.
 * @param options - `redirectTo`: for pages, redirect anonymous visitors to `/login?next=…` (303)
 *   instead of answering 401.
 * @returns The user (non-null).
 * @throws A SvelteKit `error(401)` or `redirect(303)`.
 */
export function requireUser(
	locals: GuardLocals,
	options: { redirectTo?: string } = {}
): SessionUser {
	if (!locals.user) {
		if (options.redirectTo) {
			redirect(303, `/login?next=${encodeURIComponent(options.redirectTo)}`);
		}
		error(401, 'Sign in required');
	}
	return locals.user;
}

/**
 * Requires a signed-in user with at least `role`.
 * @param locals - `event.locals`.
 * @param role - Minimum role.
 * @returns The user.
 * @throws `error(401)` when anonymous, `error(403)` when the role is too low.
 * @example
 * export const load = ({ locals }) => { requireRole(locals, 'admin'); };
 */
export function requireRole(locals: GuardLocals, role: Role): SessionUser {
	const user = requireUser(locals);
	if (!hasRole(user.role, role)) error(403, 'You do not have permission to do this');
	return user;
}
