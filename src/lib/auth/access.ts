/**
 * @fileoverview UI-side access helper built on the central route policy in `roles.ts`.
 *
 * The server hook (`hooks.server.ts`) is the only place that *enforces* access. This helper lets
 * navigation components decide which links are worth showing, using the very same policy so the
 * menu can never promise a page the server would refuse. Hiding a link is a convenience, not a
 * security measure.
 */

import { hasRole, requiredRoleFor, type Role } from './roles.js';

/**
 * Whether a user with `role` may open `pathname` with a normal page request (GET).
 *
 * @param role - Role of the signed-in user, or `null`/`undefined` when anonymous.
 * @param pathname - URL path without query string, e.g. `/component-editor`.
 * @returns `true` for public paths and when the role satisfies the policy.
 * @example
 * canAccess('user', '/editor'); // true
 * canAccess('user', '/component-editor'); // false (needs poweruser)
 * canAccess(null, '/about'); // true (public)
 */
export function canAccess(role: Role | null | undefined, pathname: string): boolean {
	const required = requiredRoleFor(pathname, 'GET');
	return required === 'public' || hasRole(role, required);
}
