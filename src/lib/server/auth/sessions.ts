/**
 * @fileoverview Server-side session management (opaque random tokens, hashed at rest).
 *
 * ## Design
 * - The browser holds a random 256-bit token in the `session` cookie (HttpOnly, SameSite=Lax,
 *   `Secure` over https). The token is never stored: the `sessions.id` column holds
 *   `sha256(token)` (hex), so a leaked database / backup cannot be replayed as a login.
 * - Sessions last 30 days and slide: when fewer than 15 days remain a valid request extends them
 *   again to 30 days (the hook then re-sets the cookie).
 * - A session of a disabled or deleted user is rejected and purged.
 *
 * Timestamps are ISO-8601 strings (see the portable SQL rules in `database/types.ts`).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { isRole, type Role } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/types.js';
import type { SqlClient } from '../database/types.js';

/** Name of the session cookie. */
export const sessionCookieName = 'session';

/** Lifetime of a (renewed) session. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** A session is extended when less than this remains. */
export const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

/** Request metadata stored for the "active sessions" view. */
export type SessionMeta = { ip?: string | null; userAgent?: string | null };

/** Successful result of {@link validateSessionToken}. */
export type ValidatedSession = {
	user: SessionUser;
	/** `sha256(token)`; the primary key of the session row. */
	sessionId: string;
	/** Current expiry (already extended when `renewed` is set). */
	expiresAt: Date;
	/** Present when the expiry was just extended; the caller should refresh the cookie. */
	renewed?: { token?: never; expiresAt: Date };
};

/** A session as listed on the account page. */
export type SessionSummary = {
	id: string;
	createdAt: string;
	expiresAt: string;
	ip: string | null;
	userAgent: string | null;
};

/** Hashes a raw token into the stored session id. */
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a session for a user.
 * @param db - Database client.
 * @param userId - Owner of the session.
 * @param meta - Optional client IP / User-Agent (truncated before storing).
 * @returns The raw token (give it to the browser once, never store it) and its expiry.
 * @example
 * const { token, expiresAt } = await createSession(db, user.id, { ip });
 * setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
 */
export async function createSession(
	db: SqlClient,
	userId: string,
	meta: SessionMeta = {}
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
	await db.run(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[
			hashToken(token),
			userId,
			now.toISOString(),
			expiresAt.toISOString(),
			meta.ip?.slice(0, 64) ?? null,
			meta.userAgent?.slice(0, 300) ?? null
		]
	);
	return { token, expiresAt };
}

/**
 * Resolves a cookie token to its user.
 * @param db - Database client.
 * @param token - Raw token from the cookie.
 * @param now - Clock injection for tests.
 * @returns The session, or `null` when the token is unknown/expired or the user is disabled.
 *   Expired and disabled-user sessions are deleted as a side effect.
 */
export async function validateSessionToken(
	db: SqlClient,
	token: string,
	now: Date = new Date()
): Promise<ValidatedSession | null> {
	// Reject obviously malformed values without touching the database.
	if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
	const sessionId = hashToken(token);
	const row = await db.get<{
		expires_at: string;
		user_id: string;
		email: string | null;
		name: string;
		role: string;
		disabled: number;
	}>(
		`SELECT s.expires_at, u.id AS user_id, u.email, u.name, u.role, u.disabled
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.id = ?`,
		[sessionId]
	);
	if (!row) return null;

	let expiresAt = new Date(row.expires_at);
	if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
		await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
		return null;
	}
	if (Number(row.disabled) === 1) {
		await invalidateUserSessions(db, row.user_id);
		return null;
	}
	// A role outside the known set (tampered row) is treated like no session: fail closed.
	if (!isRole(row.role)) return null;

	const user: SessionUser = {
		id: row.user_id,
		email: row.email,
		name: row.name,
		role: row.role as Role
	};
	const result: ValidatedSession = { user, sessionId, expiresAt };
	if (expiresAt.getTime() - now.getTime() < SESSION_RENEW_THRESHOLD_MS) {
		expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
		await db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [
			expiresAt.toISOString(),
			sessionId
		]);
		result.expiresAt = expiresAt;
		result.renewed = { expiresAt };
	}
	return result;
}

/**
 * Deletes one session (logout).
 * @param db - Database client.
 * @param token - Raw token from the cookie.
 */
export async function invalidateSession(db: SqlClient, token: string): Promise<void> {
	await db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
}

/**
 * Deletes all sessions of a user (disable, delete, password reset, "sign out everywhere").
 * @param db - Database client.
 * @param userId - The user.
 * @param exceptSessionId - Session id (hash) to keep, typically the caller's current session.
 */
export async function invalidateUserSessions(
	db: SqlClient,
	userId: string,
	exceptSessionId?: string
): Promise<void> {
	if (exceptSessionId) {
		await db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, exceptSessionId]);
	} else {
		await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
	}
}

/**
 * Lists a user's unexpired sessions, newest first.
 * @param db - Database client.
 * @param userId - The user.
 */
export async function listUserSessions(db: SqlClient, userId: string): Promise<SessionSummary[]> {
	const rows = await db.all<{
		id: string;
		created_at: string;
		expires_at: string;
		ip: string | null;
		user_agent: string | null;
	}>(
		`SELECT id, created_at, expires_at, ip, user_agent FROM sessions
		 WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`,
		[userId, new Date().toISOString()]
	);
	return rows.map((r) => ({
		id: r.id,
		createdAt: r.created_at,
		expiresAt: r.expires_at,
		ip: r.ip,
		userAgent: r.user_agent
	}));
}

/**
 * Deletes all expired sessions.
 * @param db - Database client.
 * @returns Number of deleted rows.
 */
export async function purgeExpired(db: SqlClient): Promise<number> {
	const { changes } = await db.run('DELETE FROM sessions WHERE expires_at <= ?', [
		new Date().toISOString()
	]);
	return changes;
}

/**
 * Sets the session cookie.
 * @param cookies - SvelteKit cookies of the current request.
 * @param token - Raw session token.
 * @param expiresAt - Session expiry; becomes the cookie `Max-Age`.
 * @param secure - `true` on https. Plain `http://localhost` development needs `false`, otherwise
 *   browsers would drop the cookie.
 */
export function setSessionCookie(
	cookies: Cookies,
	token: string,
	expiresAt: Date,
	secure: boolean
): void {
	cookies.set(sessionCookieName, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
	});
}

/**
 * Removes the session cookie.
 * @param cookies - SvelteKit cookies of the current request.
 */
export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(sessionCookieName, { path: '/' });
}
