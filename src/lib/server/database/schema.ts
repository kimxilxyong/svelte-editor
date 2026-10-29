/**
 * @fileoverview Portable database schema (DDL) shared by the SQLite and PostgreSQL backends.
 *
 * {@link ensureSchema} is idempotent (`CREATE TABLE IF NOT EXISTS`) and is run every time a backend is
 * opened, so a fresh database becomes usable without a separate "create tables" step.
 *
 * ## Tables
 * - `editor_page`   – the saved page-builder site (JSON text under id `site`; legacy id `home`).
 * - `task`          – legacy demo table kept for backward compatibility.
 * - `users`         – accounts. `email` is stored lower-cased and is optional (wallet-only accounts have none).
 *                     `password_hash` is an Argon2id PHC string or NULL (OAuth/wallet-only accounts).
 *                     `role` ∈ guest | user | poweruser | admin. `disabled` 1 blocks sign-in.
 * - `user_identities` – external sign-in methods linked to a user: `provider` ∈ github | google | linkedin | wallet,
 *                     `provider_user_id` is the provider's stable subject (wallet: lower-case 0x address).
 * - `sessions`      – server-side sessions. `id` is the SHA-256 hex of the opaque cookie token, so a database
 *                     leak does not reveal usable tokens.
 * - `auth_nonces`   – single-use, short-lived nonces for wallet (SIWE) sign-in.
 * - `app_settings`  – key/value settings editable by admins (e.g. `auth.allowRegistration`).
 * - `audit_log`     – security relevant events (sign-in, role change, user deletion, backend switch …).
 *
 * See `types.ts` for the portable SQL dialect rules. Foreign keys cascade on user deletion.
 */

import type { SqlClient } from './types.js';

/** Ordered DDL statements. Order matters for foreign keys. */
export const schemaStatements: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS task (
		id TEXT PRIMARY KEY NOT NULL,
		title TEXT NOT NULL,
		priority INTEGER NOT NULL DEFAULT 1
	)`,
	`CREATE TABLE IF NOT EXISTS editor_page (
		id TEXT PRIMARY KEY NOT NULL,
		blocks TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY NOT NULL,
		email TEXT UNIQUE,
		email_verified INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL,
		password_hash TEXT,
		role TEXT NOT NULL DEFAULT 'guest',
		disabled INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		last_login_at TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS user_identities (
		id TEXT PRIMARY KEY NOT NULL,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		provider TEXT NOT NULL,
		provider_user_id TEXT NOT NULL,
		label TEXT,
		created_at TEXT NOT NULL,
		UNIQUE (provider, provider_user_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id)`,
	`CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY NOT NULL,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		ip TEXT,
		user_agent TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
	`CREATE TABLE IF NOT EXISTS auth_nonces (
		nonce TEXT PRIMARY KEY NOT NULL,
		purpose TEXT NOT NULL,
		expires_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY NOT NULL,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS audit_log (
		id TEXT PRIMARY KEY NOT NULL,
		at TEXT NOT NULL,
		actor_id TEXT,
		actor_label TEXT,
		action TEXT NOT NULL,
		target TEXT,
		detail TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at)`
];

/** Tables in dependency order (parents first). Used by the backend migration copy. */
export const copyOrder: readonly string[] = [
	'task',
	'editor_page',
	'users',
	'user_identities',
	'sessions',
	'auth_nonces',
	'app_settings',
	'audit_log'
];

/**
 * Creates all tables and indexes that do not exist yet.
 *
 * @param client - Any open {@link SqlClient}.
 */
export async function ensureSchema(client: SqlClient): Promise<void> {
	await client.transaction(async (tx) => {
		for (const statement of schemaStatements) await tx.exec(statement);
	});
}
