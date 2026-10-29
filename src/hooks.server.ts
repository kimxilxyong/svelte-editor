/**
 * @fileoverview SvelteKit server hook: the single enforcement point for authentication and access.
 *
 * For every request (in this order):
 * 1. **Prerender bypass** – while building, requests only reach public prerendered pages.
 * 2. **CSRF origin check** – state-changing requests (POST/PUT/PATCH/DELETE) carrying an `Origin`
 *    header that differs from the server origin are refused (SvelteKit protects form posts; this
 *    also covers JSON endpoints).
 * 3. **Session** – the `session` cookie is resolved to `event.locals.user` / `locals.sessionId`;
 *    sliding renewal re-issues the cookie; stale cookies are removed.
 * 4. **First run** – while no user exists everything except `/setup` leads to `/setup`.
 * 5. **Access policy** – `requiredRoleFor` (roles.ts) decides: anonymous page → `303 /login?next=…`,
 *    anonymous API → `401 JSON`, too low a role → `403` (error page or JSON).
 * 6. **Security headers** on every response.
 *
 * Pages that are prerendered (`export const prerender = true`) are served as static files and never
 * reach this hook at runtime, so only genuinely public pages (`/about`) may be prerendered.
 */

import { error, redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { DATABASE_URL } from '$app/env/private';
import { hasRole, requiredRoleFor } from './lib/auth/roles.js';
import { needsSetup } from './lib/server/auth/flow.js';
import {
	clearSessionCookie,
	purgeExpired,
	sessionCookieName,
	setSessionCookie,
	validateSessionToken
} from './lib/server/auth/sessions.js';
import type { SqlClient } from './lib/server/database/types.js';
import { getDatabase } from './lib/server/database/manager.js';

// `.env` values are not copied into process.env by Vite; the database manager reads process.env,
// so expose the validated value there unless a real environment variable already wins.
process.env.DATABASE_URL ??= DATABASE_URL;

/** Methods that may change state and therefore need the CSRF origin check. */
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Expired sessions are purged at most this often (per process). */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurge = 0;

/** Static framework assets never need a session (and must not trigger a database round trip). */
function isFrameworkAsset(pathname: string): boolean {
	return pathname.startsWith('/_app/immutable/') || pathname === '/_app/version.json';
}

/**
 * Whether the request expects a machine-readable answer instead of a rendered page / redirect.
 * @param request - The incoming request.
 * @param pathname - Its URL path.
 */
function wantsJson(request: Request, pathname: string): boolean {
	if (request.method !== 'GET' && request.method !== 'HEAD') return true;
	if (/(^|\/)api(\/|$)/.test(pathname) || pathname.startsWith('/_app/remote')) return true;
	const accept = request.headers.get('accept') ?? '';
	return accept.includes('application/json') && !accept.includes('text/html');
}

/** A JSON error response. */
function jsonError(status: number, message: string, headers?: HeadersInit): Response {
	return Response.json({ error: message }, { status, headers });
}

/** Adds the security headers; falls back to a copy when the response headers are immutable. */
function withSecurityHeaders(response: Response): Response {
	const apply = (r: Response) => {
		r.headers.set('X-Content-Type-Options', 'nosniff');
		r.headers.set('X-Frame-Options', 'DENY');
		r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		r.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
		return r;
	};
	try {
		return apply(response);
	} catch {
		return apply(new Response(response.body, response));
	}
}

/**
 * Builds the `login` redirect target, preserving where the visitor wanted to go.
 * The value is always a same-site absolute path: `//host` (protocol-relative) is rejected.
 */
function loginRedirect(url: URL): string {
	const target = url.pathname + url.search;
	const safe = target.startsWith('/') && !target.startsWith('//') ? target : '/';
	return `/login?next=${encodeURIComponent(safe)}`;
}

/** Resolves the session cookie into `event.locals`. */
async function attachSession(db: SqlClient, event: Parameters<Handle>[0]['event']): Promise<void> {
	event.locals.user = null;
	event.locals.sessionId = null;
	const token = event.cookies.get(sessionCookieName);
	if (!token) return;
	const session = await validateSessionToken(db, token);
	if (!session) {
		clearSessionCookie(event.cookies);
		return;
	}
	event.locals.user = session.user;
	event.locals.sessionId = session.sessionId;
	if (session.renewed) {
		setSessionCookie(event.cookies, token, session.expiresAt, event.url.protocol === 'https:');
	}
}

/** The application `handle` hook; see the file overview for the order of checks. */
export const handle: Handle = async ({ event, resolve }) => {
	const { url, request } = event;

	if (building || isFrameworkAsset(url.pathname)) {
		event.locals.user = null;
		event.locals.sessionId = null;
		return resolve(event);
	}

	// 2. CSRF: a browser always sends Origin on cross-site unsafe requests.
	const origin = request.headers.get('origin');
	if (unsafeMethods.has(request.method) && origin !== null && origin !== url.origin) {
		return withSecurityHeaders(jsonError(403, 'Cross-site request blocked'));
	}

	let db: SqlClient;
	try {
		db = await getDatabase();
	} catch (cause) {
		console.error('Database unavailable.', cause);
		return withSecurityHeaders(jsonError(503, 'The database is unavailable'));
	}

	// 3. Session.
	await attachSession(db, event);
	if (Date.now() - lastPurge > PURGE_INTERVAL_MS) {
		lastPurge = Date.now();
		purgeExpired(db).catch((cause) => console.error('Session purge failed.', cause));
	}

	// 4. First-run setup. A signed-in user implies setup is done, so only anonymous requests ask.
	if (!event.locals.user) {
		const setupPending = await needsSetup(db);
		const isSetupPath = url.pathname === '/setup' || url.pathname.startsWith('/setup/');
		if (setupPending && !isSetupPath) {
			if (wantsJson(request, url.pathname)) {
				return withSecurityHeaders(jsonError(503, 'Setup required'));
			}
			redirect(303, '/setup');
		}
		if (!setupPending && url.pathname === '/setup' && request.method === 'GET') {
			redirect(303, '/login');
		}
	}

	// 5. Access policy.
	const required = requiredRoleFor(url.pathname, request.method);
	if (required !== 'public') {
		const user = event.locals.user;
		if (!user) {
			if (wantsJson(request, url.pathname)) {
				return withSecurityHeaders(jsonError(401, 'Sign in required'));
			}
			redirect(303, loginRedirect(url));
		}
		if (!hasRole(user.role, required)) {
			if (wantsJson(request, url.pathname)) {
				return withSecurityHeaders(jsonError(403, 'You do not have permission to do this'));
			}
			error(403, 'You do not have permission to view this page');
		}
	}

	return withSecurityHeaders(await resolve(event));
};
