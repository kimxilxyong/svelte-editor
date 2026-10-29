/**
 * @fileoverview Server-side helpers shared by the `/admin` and `/admin/users` route modules.
 *
 * Responsibilities (kept out of the route files so they can be unit-tested without SvelteKit):
 * - reading and validating the database-backend form ({@link readDatabaseForm});
 * - turning thrown errors into **safe** user-facing messages ({@link scrubSecrets},
 *   {@link describeError}) – connection strings and passwords must never reach the browser;
 * - mapping {@link AuthError} codes to HTTP statuses ({@link statusForAuthError});
 * - small query helpers (role counts) and form-data readers.
 *
 * Depends only on the portable {@link SqlClient} and the isomorphic auth modules, so it runs under
 * plain Vitest.
 */

import { roles, type Role } from '../../auth/roles.js';
import type { DataMode, DatabaseFormValues } from '../../admin/types.js';
import { AuthError, type AuthErrorCode } from '../auth/errors.js';
import type { SqlClient } from '../database/types.js';

/** Word an administrator must type to confirm that a target database will be overwritten. */
export const REPLACE_CONFIRM_WORD = 'REPLACE';

/** Placeholder that replaces secrets inside error text. */
const REDACTED = '[redacted]';

/** Longest error text shown to the browser. */
const MAX_ERROR_LENGTH = 300;

/**
 * Removes credentials from an error message so that it is safe to show in the browser.
 *
 * Defence in depth, applied in this order:
 * 1. every explicitly supplied secret (for example the submitted connection URL, its password and
 *    user name, and their URL-decoded forms) is replaced literally;
 * 2. any remaining `postgres://…` / `postgresql://…` URL is replaced;
 * 3. any `scheme://user:password@` userinfo is replaced;
 * 4. `password=…` key/value fragments are redacted;
 * 5. the result is truncated.
 *
 * @param message - Raw error text (for example from `pg` or a driver).
 * @param secrets - Strings that must not appear in the output (empty / very short ones are ignored
 *   to avoid shredding the message with one-character matches).
 * @returns The scrubbed text.
 * @example
 * scrubSecrets('connect failed for postgres://u:hunter2@db/x', ['hunter2']);
 * // 'connect failed for [redacted]'
 */
export function scrubSecrets(message: string, secrets: readonly string[] = []): string {
	let text = message;
	const candidates = new Set<string>();
	for (const secret of secrets) {
		if (!secret) continue;
		candidates.add(secret);
		try {
			// A URL's userinfo is percent-encoded; drivers print the decoded form.
			const url = new URL(secret);
			for (const part of [url.username, url.password]) {
				if (!part) continue;
				candidates.add(part);
				candidates.add(decodeURIComponent(part));
			}
		} catch {
			// Not a URL (or malformed escape) – the literal value is still redacted.
		}
	}
	// Longest first so a full URL is replaced before the password that is part of it.
	for (const secret of [...candidates]
		.filter((s) => s.length >= 3)
		.sort((a, b) => b.length - a.length)) {
		text = text.split(secret).join(REDACTED);
	}
	text = text
		.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, REDACTED)
		.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@'"<>]*@/gi, `$1${REDACTED}@`)
		.replace(/\b(password|passwd|pwd)\s*[=:]\s*[^\s,;'"]+/gi, `$1=${REDACTED}`);
	return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

/**
 * Converts any thrown value into text that may be displayed to an administrator.
 *
 * - {@link AuthError}s carry user-presentable messages by contract and are passed through.
 * - Other `Error`s are only shown when `exposeErrors` is set (database actions, where the message
 *   is the useful part, e.g. "Copy requires the target users table to be empty.") and are always
 *   scrubbed. Stack traces are never included.
 * - Anything else becomes a generic message; unexpected errors are logged server-side by the caller.
 *
 * @param error - The caught value.
 * @param options - `secrets` to redact; `exposeErrors` to allow scrubbed plain `Error` messages;
 *   `fallback` text for hidden errors.
 * @returns Safe message.
 */
export function describeError(
	error: unknown,
	options: { secrets?: readonly string[]; exposeErrors?: boolean; fallback?: string } = {}
): string {
	if (error instanceof AuthError) return scrubSecrets(error.message, options.secrets);
	if (options.exposeErrors && error instanceof Error && error.message) {
		return scrubSecrets(error.message, options.secrets);
	}
	return options.fallback ?? 'Something went wrong. Please try again.';
}

/**
 * HTTP status for a failed action, derived from the {@link AuthError} code.
 *
 * @param error - The caught value; non-{@link AuthError}s yield 500.
 * @returns 404 (not found), 403 (forbidden), 409 (conflicts), 429 (rate limit), 400 otherwise.
 */
export function statusForAuthError(error: unknown): number {
	if (!(error instanceof AuthError)) return 500;
	const byCode: Partial<Record<AuthErrorCode, number>> = {
		not_found: 404,
		forbidden: 403,
		email_taken: 409,
		identity_taken: 409,
		last_admin: 409,
		last_sign_in_method: 409,
		rate_limited: 429
	};
	return byCode[error.code] ?? 400;
}

/**
 * Reads a text field from submitted form data.
 *
 * @param form - Submitted data.
 * @param key - Field name.
 * @param maxLength - Cap applied to the value (defence against huge payloads).
 * @returns The string (not trimmed); `''` when absent or when the field is a file.
 */
export function readString(form: FormData, key: string, maxLength = 500): string {
	const value = form.get(key);
	return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/**
 * Reads a checkbox: browsers only submit checked boxes (value `on`).
 *
 * @param form - Submitted data.
 * @param key - Field name.
 */
export function readCheckbox(form: FormData, key: string): boolean {
	const value = form.get(key);
	return value === 'on' || value === 'true';
}

/** Parsed and validated database form. */
export type DatabaseForm = {
	/** Non-secret values for re-populating the form. */
	values: DatabaseFormValues;
	/** Untrusted candidate for `parseDatabaseConfig` (contains the URL – keep it server-side). */
	candidate: { backend: string; sqlitePath?: string; postgresUrl?: string };
	/** Strings that must be scrubbed from any error text (the URL, if any). */
	secrets: string[];
	/** `null` when the submitted data mode is unknown. */
	dataMode: DataMode | null;
	/** Whether the destructive-overwrite confirmation (checkbox + typed word) was given. */
	replaceConfirmed: boolean;
};

/**
 * Reads the backend form (fields `backend`, `sqlitePath`, `postgresUrl`, `dataMode`,
 * `confirmReplace`, `confirmText`).
 *
 * The PostgreSQL URL only ends up in {@link DatabaseForm.candidate} and
 * {@link DatabaseForm.secrets}; {@link DatabaseForm.values} (the part returned to the browser)
 * never contains it.
 *
 * @param form - Submitted data.
 * @returns The parsed form; semantic validation is left to `parseDatabaseConfig`.
 */
export function readDatabaseForm(form: FormData): DatabaseForm {
	const backend = readString(form, 'backend', 20) === 'postgres' ? 'postgres' : 'sqlite';
	const sqlitePath = readString(form, 'sqlitePath', 400).trim();
	const postgresUrl = readString(form, 'postgresUrl', 2000).trim();
	const rawMode = readString(form, 'dataMode', 20);
	const dataMode: DataMode | null =
		rawMode === 'copy' || rawMode === 'replace' || rawMode === 'keep' ? rawMode : null;
	return {
		values: { backend, sqlitePath, dataMode: dataMode ?? 'copy' },
		candidate: backend === 'postgres' ? { backend, postgresUrl } : { backend, sqlitePath },
		secrets: postgresUrl ? [postgresUrl] : [],
		dataMode,
		// Overwriting a database is irreversible: require BOTH an explicit tick and the typed word.
		replaceConfirmed:
			readCheckbox(form, 'confirmReplace') &&
			readString(form, 'confirmText', 40).trim() === REPLACE_CONFIRM_WORD
	};
}

/**
 * Counts users per role (every role present, zero when unused) plus the number of disabled users.
 *
 * @param db - Database client.
 * @returns `{ byRole, disabled, total }`.
 */
export async function countUsersByRole(
	db: SqlClient
): Promise<{ byRole: Record<Role, number>; disabled: number; total: number }> {
	const rows = await db.all<{ role: string; n: number | string }>(
		'SELECT role, CAST(COUNT(*) AS INTEGER) AS n FROM users GROUP BY role'
	);
	const byRole = Object.fromEntries(roles.map((role) => [role, 0])) as Record<Role, number>;
	let total = 0;
	for (const row of rows) {
		const count = Number(row.n);
		total += count;
		if ((roles as readonly string[]).includes(row.role)) byRole[row.role as Role] = count;
	}
	const disabledRow = await db.get<{ n: number | string }>(
		'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE disabled = 1'
	);
	return { byRole, disabled: Number(disabledRow?.n ?? 0), total };
}

/**
 * Names of the environment variables that configure an OAuth provider (mirrors
 * `oauth-config.ts`, which keeps its table private) and the redirect URI to register.
 *
 * @param id - Provider id such as `github`.
 * @param origin - Public origin of this server (`url.origin`).
 * @returns Variable names and callback URL `${origin}/auth/<id>/callback`.
 * @example
 * providerSetup('google', 'https://app.test').callbackUrl; // 'https://app.test/auth/google/callback'
 */
export function providerSetup(
	id: string,
	origin: string
): { clientId: string; clientSecret: string; callbackUrl: string } {
	const prefix = id.toUpperCase();
	return {
		clientId: `${prefix}_CLIENT_ID`,
		clientSecret: `${prefix}_CLIENT_SECRET`,
		callbackUrl: `${origin}/auth/${id}/callback`
	};
}

/**
 * Builds the identity recorded in audit entries for the acting administrator.
 *
 * @param user - `locals.user` (after `requireRole`).
 */
export function auditActor(user: { id: string; email: string | null; name: string }): {
	id: string;
	label: string;
} {
	return { id: user.id, label: user.email ?? user.name };
}
