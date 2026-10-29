/**
 * @fileoverview Glue shared by every sign-in entry point (password form, OAuth callback, wallet).
 *
 * Keeps the security-sensitive session start in one place so all methods behave identically:
 * the previous session is revoked (prevents session fixation), a fresh token is issued with the
 * correct cookie flags, and the login is recorded.
 */

import type { RequestEvent } from '@sveltejs/kit';
import type { SqlClient } from '../database/types.js';
import {
	createSession,
	invalidateSession,
	sessionCookieName,
	setSessionCookie
} from './sessions.js';
import { recordLogin } from './users.js';

/**
 * Best-effort client IP (adapter specific; may be unavailable in tests or behind odd proxies).
 * @param event - Request event.
 * @returns The address or `'unknown'`.
 */
export function clientIp(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

/** Control characters and backslashes never belong in a redirect target. */
// eslint-disable-next-line no-control-regex
const unsafePathChars = /[\u0000-\u001f\\]/;

/**
 * Validates a post-login redirect target to prevent open redirects.
 * @param raw - Untrusted `next` value (query string / cookie).
 * @param fallback - Returned when `raw` is not a safe same-site path.
 * @returns A path starting with a single `/`, never an absolute or protocol-relative URL.
 * @example
 * safeNext('/admin/users'); // '/admin/users'
 * safeNext('//evil.example'); // '/'
 * safeNext('https://evil.example'); // '/'
 */
export function safeNext(raw: string | null | undefined, fallback = '/'): string {
	if (!raw || raw.length > 500) return fallback;
	// `/\evil` is treated like `//evil` by browsers; control characters can smuggle headers.
	if (
		!raw.startsWith('/') ||
		raw.startsWith('//') ||
		raw.startsWith('/\\') ||
		unsafePathChars.test(raw)
	) {
		return fallback;
	}
	return raw;
}

/**
 * Starts a session for an authenticated user: revokes the current one, sets the cookie, records the login.
 * @param event - Request event (cookies, url, user agent, address).
 * @param db - Database client.
 * @param userId - The user who has just proven their identity.
 */
export async function establishSession(
	event: Pick<RequestEvent, 'cookies' | 'url' | 'request' | 'getClientAddress'>,
	db: SqlClient,
	userId: string
): Promise<void> {
	const previous = event.cookies.get(sessionCookieName);
	if (previous) await invalidateSession(db, previous);
	const { token, expiresAt } = await createSession(db, userId, {
		ip: clientIp(event),
		userAgent: event.request.headers.get('user-agent')
	});
	setSessionCookie(event.cookies, token, expiresAt, event.url.protocol === 'https:');
	await recordLogin(db, userId);
}
