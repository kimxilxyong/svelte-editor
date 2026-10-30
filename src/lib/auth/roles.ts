/**
 * @fileoverview Roles, role hierarchy and the central route access policy.
 *
 * This module is **isomorphic** (no server-only imports) so the same rules drive the server hooks
 * (enforcement), the navigation (what to show) and the admin UI (what may be assigned).
 *
 * ## Roles (ascending privilege; each role includes everything below it)
 * | role        | may                                                                              |
 * |-------------|----------------------------------------------------------------------------------|
 * | `guest`     | sign in, view pages and previews (read-only), manage own account                  |
 * | `user`      | additionally edit & save pages in the page builder                                |
 * | `poweruser` | additionally use the component (source) editor and project export/import, i.e. work with server files |
 * | `admin`     | additionally open `/admin`: database backend, authentication settings, user management |
 *
 * ## Access policy
 * {@link requiredRoleFor} maps a request (`pathname` + HTTP method) to the minimum role, or `'public'`
 * for anonymous access. The hook in `hooks.server.ts` enforces it for every request, so individual
 * routes only add *extra* checks (for example "last admin" protection).
 */

/** All roles from least to most privileged. */
export const roles = ['guest', 'user', 'poweruser', 'admin'] as const;

/** A user role. */
export type Role = (typeof roles)[number];

/** Human readable role names and one-line descriptions for the UI. */
export const roleInfo: Record<Role, { label: string; description: string }> = {
	guest: { label: 'Guest', description: 'Read-only: view pages and previews.' },
	user: { label: 'User', description: 'Edit and save pages in the page builder.' },
	poweruser: {
		label: 'Power user',
		description: 'Also edit component source files and export/import projects.'
	},
	admin: {
		label: 'Admin',
		description: 'Full access including database backend and user management.'
	}
};

/**
 * Type guard for untrusted input.
 *
 * @param value - Any value (form field, JSON property, database column).
 */
export function isRole(value: unknown): value is Role {
	return typeof value === 'string' && (roles as readonly string[]).includes(value);
}

/**
 * Numeric rank of a role (0 = guest … 3 = admin).
 *
 * @param role - The role to rank.
 */
export function roleRank(role: Role): number {
	return roles.indexOf(role);
}

/**
 * Whether `actual` is at least `minimum`.
 *
 * @param actual - Role of the signed-in user, or `null`/`undefined` when anonymous.
 * @param minimum - Required role.
 * @returns `false` for anonymous users.
 * @example
 * hasRole('poweruser', 'user'); // true
 * hasRole(null, 'guest'); // false
 */
export function hasRole(actual: Role | null | undefined, minimum: Role): boolean {
	return actual != null && roleRank(actual) >= roleRank(minimum);
}

/** Minimum role of a route, or `'public'` when no sign-in is needed. */
export type RequiredAccess = Role | 'public';

/** One entry of the access policy. */
type AccessRule = {
	/** Path prefix; matches the exact path or any sub-path (`/admin` matches `/admin/users`). */
	prefix: string;
	/** Minimum role for safe methods (GET/HEAD/OPTIONS). */
	read: RequiredAccess;
	/** Minimum role for modifying methods (POST/PUT/PATCH/DELETE). Defaults to `read`. */
	write?: RequiredAccess;
};

/**
 * The access policy. The **longest matching prefix wins**; paths that match nothing need `guest`
 * (any signed-in user). Keep this list the single source of truth.
 */
export const accessRules: readonly AccessRule[] = [
	{ prefix: '/login', read: 'public' },
	{ prefix: '/register', read: 'public' },
	{ prefix: '/setup', read: 'public' },
	{ prefix: '/about', read: 'public' },
	// OAuth start/callback and wallet nonce/verify endpoints must work before sign-in.
	{ prefix: '/auth', read: 'public' },
	{ prefix: '/logout', read: 'public' },
	{ prefix: '/admin', read: 'admin' },
	// Server file system access: power users and above only.
	{ prefix: '/component-editor', read: 'poweruser' },
	{ prefix: '/editor/api/project', read: 'poweruser' },
	{ prefix: '/editor/api/fs', read: 'poweruser' },
	// Saved site: everybody signed-in may read it, editors may change it.
	{ prefix: '/editor/api', read: 'guest', write: 'user' },
	{ prefix: '/editor', read: 'user' },
	{ prefix: '/composites', read: 'user' },
	// Site theme: everybody signed-in may look at it, power users may change it.
	{ prefix: '/theme', read: 'guest', write: 'poweruser' },
	{ prefix: '/account', read: 'guest' }
];

/** HTTP methods that never modify state. */
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Reduces a request path to the form the router matches against, so the policy cannot be bypassed
 * with encoded or ambiguous spellings (`/editor/api/pro%6Aect`, `//admin`, `/a/../admin`, `/admin/`).
 *
 * @param pathname - Raw URL path.
 * @returns The canonical path, or `null` when it cannot be decoded safely (callers must fail closed).
 */
function canonicalizePath(pathname: string): string | null {
	const segments: string[] = [];
	for (const raw of pathname.split('/')) {
		let segment: string;
		try {
			segment = decodeURIComponent(raw);
		} catch {
			return null;
		}
		// A decoded slash or backslash would change the segment structure after authorization.
		if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return null;
		if (segment === '' || segment === '.') continue;
		if (segment === '..') segments.pop();
		else segments.push(segment);
	}
	return '/' + segments.join('/');
}

/**
 * Looks up the minimum access for a request.
 *
 * @param pathname - URL path, e.g. `/admin/users`. A trailing slash is ignored.
 * @param method - HTTP method (case-insensitive).
 * @returns `'public'` or the minimum {@link Role}. Unknown paths require `guest`; paths that cannot be
 * canonicalised fail closed with `'admin'`.
 * @example
 * requiredRoleFor('/admin/users', 'GET'); // 'admin'
 * requiredRoleFor('/editor/api', 'POST'); // 'user'
 * requiredRoleFor('/', 'GET'); // 'guest'
 */
export function requiredRoleFor(pathname: string, method = 'GET'): RequiredAccess {
	const path = canonicalizePath(pathname);
	if (path === null) return 'admin';
	let best: AccessRule | null = null;
	for (const rule of accessRules) {
		const matches = path === rule.prefix || path.startsWith(rule.prefix + '/');
		if (matches && (!best || rule.prefix.length > best.prefix.length)) best = rule;
	}
	if (!best) return 'guest';
	return safeMethods.has(method.toUpperCase()) ? best.read : (best.write ?? best.read);
}
