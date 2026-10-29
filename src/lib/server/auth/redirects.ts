/**
 * @fileoverview Redirect-target policy for the sign-in pages (`/login`, `/register`, `/setup`).
 *
 * Builds on {@link safeNext} (which blocks open redirects) and adds the *loop* rule: after signing in
 * the user must never be sent back to a page whose only purpose is to sign in, otherwise a link such
 * as `/login?next=/login` would bounce a signed-in user between redirects forever.
 */

import { safeNext } from './login.js';

/** Path prefixes of pages that only make sense for anonymous visitors. */
const anonymousOnlyPrefixes = ['/login', '/register', '/setup'] as const;

/**
 * Resolves where to send a user who has just signed in (or who is already signed in).
 *
 * @param raw - Untrusted `next` value from the query string or a hidden form field.
 * @param fallback - Destination when `raw` is missing, unsafe or points at an anonymous-only page.
 * @returns A same-site path starting with a single `/`. Never an absolute URL (open-redirect safe).
 * @example
 * postAuthTarget('/editor?page=home'); // '/editor?page=home'
 * postAuthTarget('/login?next=/'); // '/'
 * postAuthTarget('https://evil.example'); // '/'
 */
export function postAuthTarget(raw: string | null | undefined, fallback = '/'): string {
	const target = safeNext(raw, fallback);
	const pathname = target.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
	const loops = anonymousOnlyPrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
	);
	return loops ? fallback : target;
}
