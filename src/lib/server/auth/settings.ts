/**
 * @fileoverview Typed access to the key/value `app_settings` table and the authentication settings.
 *
 * Settings:
 * - `auth.allowRegistration` (`'true'|'false'`, default `true`): may visitors create accounts
 *   themselves (password, OAuth or wallet)?
 * - `auth.defaultRole` (default `guest`): role given to self-registered accounts. `admin` is
 *   rejected on purpose – open registration must never mint administrators.
 */

import { isRole, type Role } from '../../auth/roles.js';
import type { SqlClient } from '../database/types.js';
import { AuthError } from './errors.js';

/** The authentication settings editable on `/admin`. */
export type AuthSettings = {
	allowRegistration: boolean;
	defaultRole: Role;
};

/** Settings applied when nothing is stored yet. */
export const defaultAuthSettings: Readonly<AuthSettings> = {
	allowRegistration: true,
	defaultRole: 'guest'
};

const KEY_ALLOW_REGISTRATION = 'auth.allowRegistration';
const KEY_DEFAULT_ROLE = 'auth.defaultRole';

/**
 * Reads one setting.
 * @param db - Database client.
 * @param key - Setting key.
 * @returns The stored string, or `null` when unset.
 */
export async function getSetting(db: SqlClient, key: string): Promise<string | null> {
	const row = await db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
		key
	]);
	return row?.value ?? null;
}

/**
 * Writes (upserts) one setting.
 * @param db - Database client.
 * @param key - Setting key.
 * @param value - String value.
 */
export async function setSetting(db: SqlClient, key: string, value: string): Promise<void> {
	// ON CONFLICT … DO UPDATE is supported by both SQLite (≥3.24) and PostgreSQL.
	await db.run(
		`INSERT INTO app_settings (key, value) VALUES (?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		[key, value]
	);
}

/**
 * Loads the authentication settings, falling back to {@link defaultAuthSettings} for missing or
 * corrupt values (a stored `admin` default role is treated as corrupt).
 * @param db - Database client.
 */
export async function getAuthSettings(db: SqlClient): Promise<AuthSettings> {
	const [allow, role] = await Promise.all([
		getSetting(db, KEY_ALLOW_REGISTRATION),
		getSetting(db, KEY_DEFAULT_ROLE)
	]);
	return {
		allowRegistration: allow === null ? defaultAuthSettings.allowRegistration : allow === 'true',
		defaultRole: isRole(role) && role !== 'admin' ? role : defaultAuthSettings.defaultRole
	};
}

/**
 * Updates the authentication settings.
 * @param db - Database client.
 * @param patch - Fields to change; omitted fields keep their value.
 * @returns The settings after the update.
 * @throws {AuthError} `invalid_input` when `defaultRole` is not a role or is `admin`.
 */
export async function updateAuthSettings(
	db: SqlClient,
	patch: Partial<AuthSettings>
): Promise<AuthSettings> {
	if (
		patch.defaultRole !== undefined &&
		(!isRole(patch.defaultRole) || patch.defaultRole === 'admin')
	) {
		throw new AuthError('invalid_input', 'The default role must be guest, user or poweruser.');
	}
	if (patch.allowRegistration !== undefined && typeof patch.allowRegistration !== 'boolean') {
		throw new AuthError('invalid_input', 'allowRegistration must be a boolean.');
	}
	await db.transaction(async (tx) => {
		if (patch.allowRegistration !== undefined) {
			await setSetting(tx, KEY_ALLOW_REGISTRATION, patch.allowRegistration ? 'true' : 'false');
		}
		if (patch.defaultRole !== undefined) await setSetting(tx, KEY_DEFAULT_ROLE, patch.defaultRole);
	});
	return getAuthSettings(db);
}
