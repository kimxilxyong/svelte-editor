/**
 * @fileoverview Result shapes returned by the `/admin` and `/admin/users` form actions.
 *
 * They live in `lib/` (not next to the routes) so that presentational components can accept them as
 * props without importing route-private `./$types`. All shapes are JSON serialisable and **must
 * never contain secrets**: in particular no PostgreSQL connection URL and no password is ever
 * echoed back to the browser.
 */

import type { Role } from '../auth/roles.js';

/** Data handling choice when switching the database backend. */
export type DataMode = 'copy' | 'replace' | 'keep';

/** Non-secret form values that are safe to re-populate after a failed submit. */
export type DatabaseFormValues = {
	backend: 'sqlite' | 'postgres';
	sqlitePath: string;
	dataMode: DataMode;
};

/** Outcome of the "Test connection" / "Switch backend" actions. */
export type DatabaseFeedback = {
	section: 'database';
	/** Which button was pressed. */
	action: 'testConnection' | 'switch';
	ok: boolean;
	/** Scrubbed, user-presentable error (never contains credentials or stack traces). */
	error?: string;
	/** Present after a successful connection test. */
	test?: { serverVersion?: string; hasSchema: boolean; userCount: number; adminCount: number };
	/** Present after a successful switch. */
	switched?: {
		backend: 'sqlite' | 'postgres';
		/** Masked location of the new backend. */
		location: string;
		copied: Record<string, number>;
		dataMode: DataMode;
	};
	values: DatabaseFormValues;
};

/** Outcome of the authentication settings action. */
export type SettingsFeedback = {
	section: 'settings';
	ok: boolean;
	message: string;
	/** Settings as stored after a successful update. */
	settings?: { allowRegistration: boolean; defaultRole: Role };
};

/** Outcome of a user-management action on `/admin/users`. */
export type UserActionFeedback = {
	section: 'users';
	action: 'create' | 'update' | 'setRole' | 'resetPassword' | 'delete';
	ok: boolean;
	message: string;
	/** User the action was about (empty for `create`); lets a dialog show only its own error. */
	userId?: string;
	/** Non-secret values to restore in the create form after a failed submit. */
	values?: { name: string; email: string; role: string };
};

/** Browser-safe summary of the active database backend (subset of `BackendInfo`). */
export type BackendSummary = {
	backend: 'sqlite' | 'postgres';
	/** Masked location: file path for SQLite, `******host:port/db` for PostgreSQL. */
	location: string;
	source: 'config-file' | 'env' | 'default';
	serverVersion?: string;
	userCount: number;
};

/** One external sign-in provider row on the admin overview. */
export type ProviderRow = {
	id: string;
	label: string;
	configured: boolean;
	/** Redirect URI to register at the provider. */
	callbackUrl: string;
	/** Environment variable names that enable the provider. */
	envVars: string[];
};

/** One audit-log row (mirrors `AuditEntry` of the server module without importing it). */
export type AuditRow = {
	id: string;
	at: string;
	actorLabel: string | null;
	action: string;
	target: string | null;
	detail: string | null;
};
