/**
 * @fileoverview Persistent audit trail of security-relevant events (`audit_log` table).
 *
 * Shown on the admin page. Writing an audit entry must never break the action it describes, so
 * {@link recordAudit} swallows (and logs) its own failures.
 */

import type { SqlClient } from '../database/types.js';

/** All audit actions the application emits. */
export type AuditAction =
	| 'login'
	| 'login_failed'
	| 'logout'
	| 'register'
	| 'user_create'
	| 'user_update'
	| 'user_delete'
	| 'password_change'
	| 'password_reset'
	| 'identity_link'
	| 'identity_unlink'
	| 'settings_update'
	| 'db_switch'
	| 'setup';

/** Input of {@link recordAudit}. */
export type AuditInput = {
	/** Who acted; `null`/omitted for anonymous or system events. */
	actor?: { id: string; label: string } | null;
	action: AuditAction;
	/** What was acted upon (user id/email, setting key …). */
	target?: string | null;
	/** Free-form detail. Must never contain secrets (passwords, tokens, connection strings). */
	detail?: string | null;
};

/** One row of the audit log as returned by {@link listAudit}. */
export type AuditEntry = {
	id: string;
	/** ISO-8601 timestamp. */
	at: string;
	actorId: string | null;
	actorLabel: string | null;
	action: string;
	target: string | null;
	detail: string | null;
};

/** Column length cap so a hostile value (e.g. a long User-Agent) cannot bloat the table. */
const MAX_FIELD = 500;

/** Last timestamp handed out; keeps `at` strictly increasing so "newest first" is deterministic. */
let lastAtMs = 0;

/** Returns the current time as ISO string, bumped by 1 ms when it would not advance. */
function nextTimestamp(): string {
	lastAtMs = Math.max(Date.now(), lastAtMs + 1);
	return new Date(lastAtMs).toISOString();
}

/** Truncates and strips control characters (prevents log forging in any text rendering). */
function clean(value: string | null | undefined): string | null {
	if (value == null) return null;
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_FIELD);
}

/**
 * Appends an entry to the audit log. Never throws.
 * @param db - Database client.
 * @param input - Event description.
 * @example
 * await recordAudit(db, { actor: { id: user.id, label: user.email ?? user.name }, action: 'login' });
 */
export async function recordAudit(db: SqlClient, input: AuditInput): Promise<void> {
	try {
		await db.run(
			`INSERT INTO audit_log (id, at, actor_id, actor_label, action, target, detail)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				nextTimestamp(),
				input.actor?.id ?? null,
				clean(input.actor?.label),
				input.action,
				clean(input.target),
				clean(input.detail)
			]
		);
	} catch (error) {
		console.error('Unable to write audit log entry.', error);
	}
}

/**
 * Returns the newest audit entries.
 * @param db - Database client.
 * @param limit - Maximum number of rows (1–500, default 50).
 * @returns Entries ordered newest first.
 */
export async function listAudit(db: SqlClient, limit = 50): Promise<AuditEntry[]> {
	const bounded = Math.min(500, Math.max(1, Math.trunc(Number(limit)) || 50));
	const rows = await db.all<{
		id: string;
		at: string;
		actor_id: string | null;
		actor_label: string | null;
		action: string;
		target: string | null;
		detail: string | null;
	}>(
		`SELECT id, at, actor_id, actor_label, action, target, detail
		 FROM audit_log ORDER BY at DESC LIMIT ?`,
		[bounded]
	);
	return rows.map((row) => ({
		id: row.id,
		at: row.at,
		actorId: row.actor_id,
		actorLabel: row.actor_label,
		action: row.action,
		target: row.target,
		detail: row.detail
	}));
}
