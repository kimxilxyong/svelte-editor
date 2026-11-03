/**
 * @fileoverview Portable database schema (DDL) shared by the SQLite and PostgreSQL backends.
 *
 * {@link ensureSchema} is idempotent (`CREATE TABLE IF NOT EXISTS`) and is run every time a backend is
 * opened, so a fresh database becomes usable without a separate "create tables" step.
 *
 * ## Tables
 * - `users`         – accounts. `email` is stored lower-cased and is optional (wallet-only accounts have none).
 *                     `password_hash` is an Argon2id PHC string or NULL (OAuth/wallet-only accounts).
 *                     `role` ∈ guest | user | poweruser | admin (new accounts default to `poweruser`).
 *                     `disabled` 1 blocks sign-in.
 * - `projects`      – a user's sites. Owner, display name, absolute SvelteKit folder (`path`, empty = not set)
 *                     and the project's theme (`theme`, JSON text of a `SiteTheme`). Cascades on user deletion.
 * - `project_pages` – the pages of a project (`ordinal` keeps the order; `blocks` is JSON text).
 * - `project_composites` – the composite components of a project (same shape, `name` is unique per project).
 * - `user_identities` – external sign-in methods linked to a user: `provider` ∈ github | google | linkedin | wallet,
 *                     `provider_user_id` is the provider's stable subject (wallet: lower-case 0x address).
 * - `sessions`      – server-side sessions. `id` is the SHA-256 hex of the opaque cookie token, so a database
 *                     leak does not reveal usable tokens.
 * - `auth_nonces`   – single-use, short-lived nonces for wallet (SIWE) sign-in.
 * - `app_settings`  – key/value settings editable by admins (e.g. `auth.allowRegistration`).
 * - `audit_log`     – security relevant events (sign-in, role change, user deletion, backend switch …).
 *
 * Page and composite ids are only unique *within* a project (primary key `(project_id, id)`), because
 * seeds and duplicated projects reuse ids such as `home`.
 *
 * See `types.ts` for the portable SQL dialect rules. Foreign keys cascade on user and project deletion.
 */

import type { SqlClient } from './types.js';

/** Ordered DDL statements. Order matters for foreign keys. */
export const schemaStatements: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY NOT NULL,
		email TEXT UNIQUE,
		email_verified INTEGER NOT NULL DEFAULT 0,
		name TEXT NOT NULL,
		password_hash TEXT,
		role TEXT NOT NULL DEFAULT 'poweruser',
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
	`CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at)`,
	`CREATE TABLE IF NOT EXISTS projects (
		id TEXT PRIMARY KEY NOT NULL,
		owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		path TEXT NOT NULL DEFAULT '',
		theme TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		UNIQUE (owner_id, name)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id)`,
	`CREATE TABLE IF NOT EXISTS project_pages (
		project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		id TEXT NOT NULL,
		ordinal INTEGER NOT NULL,
		name TEXT NOT NULL,
		slug TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		blocks TEXT NOT NULL,
		PRIMARY KEY (project_id, id),
		UNIQUE (project_id, slug)
	)`,
	`CREATE TABLE IF NOT EXISTS project_composites (
		project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		id TEXT NOT NULL,
		ordinal INTEGER NOT NULL,
		name TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		blocks TEXT NOT NULL,
		PRIMARY KEY (project_id, id),
		UNIQUE (project_id, name)
	)`
];

/** Tables in dependency order (parents first). Used by the backend migration copy. */
export const copyOrder: readonly string[] = [
	'users',
	'user_identities',
	'sessions',
	'auth_nonces',
	'app_settings',
	'audit_log',
	'projects',
	'project_pages',
	'project_composites'
];

/** Tables of earlier schema versions; they are removed by {@link dropAllTables} as well. */
const legacyTables: readonly string[] = ['editor_page', 'task'];

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

/**
 * Drops every application table (including tables of earlier schema versions) and nothing else.
 *
 * Children are dropped before their parents so foreign keys never block the drop on either backend.
 * Only database tables are affected: widget overrides (`.data/widgets`) and project folders on disk
 * are untouched.
 *
 * @param client - Any open {@link SqlClient}.
 * @example
 * await dropAllTables(db);
 */
export async function dropAllTables(client: SqlClient): Promise<void> {
	await client.transaction(async (tx) => {
		for (const table of [...copyOrder].reverse()) await tx.exec(`DROP TABLE IF EXISTS ${table}`);
		for (const table of legacyTables) await tx.exec(`DROP TABLE IF EXISTS ${table}`);
	});
}

/**
 * Deletes all tables and creates them again, empty. This erases users, sessions, settings, the audit
 * log and all projects; the next visitor has to run the first-run setup.
 *
 * @param client - Any open {@link SqlClient}.
 * @example
 * await recreateSchema(db);
 */
export async function recreateSchema(client: SqlClient): Promise<void> {
	await dropAllTables(client);
	await ensureSchema(client);
}
