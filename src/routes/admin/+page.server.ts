/**
 * @fileoverview Server module of the admin overview (`/admin`).
 *
 * - `load`: database backend status, authentication settings, sign-in provider status, the newest
 *   audit entries and a user-count-by-role summary.
 * - `actions.testConnection` / `actions.switch`: test a candidate backend / switch the active one.
 * - `actions.updateSettings`: change registration policy and default role.
 *
 * ## Security model
 * `hooks.server.ts` already restricts `/admin/**` to admins. Every `load` and **every action**
 * nevertheless calls {@link requireRole} again (defence in depth – e.g. if the access table is
 * edited by mistake), and actions take the acting admin from `locals.user`, never from the form.
 * Connection URLs are only ever read from the POST body on the server; neither the URL nor
 * credentials contained in error messages are returned to the browser (see `scrubSecrets`).
 */

import { fail } from '@sveltejs/kit';
import { isRole } from '../../lib/auth/roles.js';
import type { BackendSummary, DatabaseFeedback, SettingsFeedback } from '../../lib/admin/types.js';
import {
	auditActor,
	countUsersByRole,
	describeError,
	providerSetup,
	readCheckbox,
	readDatabaseForm,
	readString,
	scrubSecrets,
	type DatabaseForm
} from '../../lib/server/admin/helpers.js';
import { recordAudit, listAudit } from '../../lib/server/auth/audit.js';
import { requireRole } from '../../lib/server/auth/guard.js';
import { getOAuthProviderStatus } from '../../lib/server/auth/oauth-config.js';
import { getRuntimeOAuthConfig } from '../../lib/server/auth/runtime-config.js';
import { getAuthSettings, updateAuthSettings } from '../../lib/server/auth/settings.js';
import {
	describeActiveBackend,
	getActiveConfig,
	getDatabase,
	maskConfig,
	parseDatabaseConfig,
	switchBackend,
	testConnection
} from '../../lib/server/database/manager.js';
import type { DatabaseConfig } from '../../lib/server/database/types.js';
import type { Actions, PageServerLoad } from './$types';

/** Number of audit entries shown on the overview. */
const AUDIT_LIMIT = 50;

/** Whether two validated configurations point at the same database. */
function isSameConfig(a: DatabaseConfig, b: DatabaseConfig): boolean {
	if (a.backend === 'sqlite' && b.backend === 'sqlite') return a.sqlitePath === b.sqlitePath;
	if (a.backend === 'postgres' && b.backend === 'postgres') return a.postgresUrl === b.postgresUrl;
	return false;
}

/** Builds a failed database feedback (the URL is deliberately absent from `values`). */
function databaseFailure(
	action: DatabaseFeedback['action'],
	form: DatabaseForm,
	error: unknown,
	message?: string
) {
	const feedback: DatabaseFeedback = {
		section: 'database',
		action,
		ok: false,
		error: message ?? describeError(error, { secrets: form.secrets, exposeErrors: true }),
		values: form.values
	};
	return fail(400, feedback);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	requireRole(locals, 'admin');
	const db = await getDatabase();
	const [info, settings, audit, users] = await Promise.all([
		describeActiveBackend(),
		getAuthSettings(db),
		listAudit(db, AUDIT_LIMIT),
		countUsersByRole(db)
	]);

	// Only the fields the browser may see (location is already masked by the manager).
	const backend: BackendSummary = {
		backend: info.backend,
		location: info.location,
		source: info.source,
		serverVersion: info.serverVersion,
		userCount: info.userCount
	};
	const providers = getOAuthProviderStatus(getRuntimeOAuthConfig()).map((status) => {
		const setup = providerSetup(status.id, url.origin);
		return {
			id: status.id,
			label: status.label,
			configured: status.configured,
			callbackUrl: setup.callbackUrl,
			envVars: [setup.clientId, setup.clientSecret]
		};
	});

	return {
		backend,
		settings,
		providers,
		users,
		audit: audit.map((entry) => ({
			id: entry.id,
			at: entry.at,
			actorLabel: entry.actorLabel,
			action: entry.action,
			target: entry.target,
			detail: entry.detail
		}))
	};
};

export const actions: Actions = {
	/** Opens a temporary connection to the candidate backend and reports what is there. */
	testConnection: async ({ locals, request }) => {
		requireRole(locals, 'admin');
		const form = readDatabaseForm(await request.formData());
		let config: DatabaseConfig;
		try {
			config = parseDatabaseConfig(form.candidate);
		} catch (error) {
			return databaseFailure('testConnection', form, error);
		}
		try {
			const result = await testConnection(config);
			if (!result.ok) {
				return databaseFailure(
					'testConnection',
					form,
					null,
					scrubSecrets(result.error ?? 'Unable to connect.', form.secrets)
				);
			}
			const feedback: DatabaseFeedback = {
				section: 'database',
				action: 'testConnection',
				ok: true,
				test: {
					serverVersion: result.serverVersion,
					hasSchema: result.hasSchema,
					userCount: result.userCount,
					adminCount: result.adminCount
				},
				values: form.values
			};
			return feedback;
		} catch (error) {
			console.error(
				'[admin] connection test failed:',
				describeError(error, { exposeErrors: true, secrets: form.secrets })
			);
			return databaseFailure('testConnection', form, error);
		}
	},

	/**
	 * Switches the active backend. `switchBackend` copies the data according to `dataMode`, persists
	 * the configuration and records the `db_switch` audit entry itself (in the new database); this
	 * action only adds an entry for the no-op case "already active".
	 */
	switch: async ({ locals, request }) => {
		const user = requireRole(locals, 'admin');
		const form = readDatabaseForm(await request.formData());
		if (!form.dataMode) {
			return databaseFailure('switch', form, null, 'Choose how to handle the existing data.');
		}
		// Server-side re-check of the destructive confirmation (the UI only mirrors it).
		if (form.dataMode === 'replace' && !form.replaceConfirmed) {
			return databaseFailure(
				'switch',
				form,
				null,
				'Replacing needs the confirmation box ticked and the word REPLACE typed.'
			);
		}
		let config: DatabaseConfig;
		try {
			config = parseDatabaseConfig(form.candidate);
		} catch (error) {
			return databaseFailure('switch', form, error);
		}
		try {
			const before = await getActiveConfig();
			const actor = auditActor(user);
			const result = await switchBackend(config, { dataMode: form.dataMode, actor });
			if (isSameConfig(before, config)) {
				await recordAudit(await getDatabase(), {
					actor,
					action: 'db_switch',
					target: result.backend,
					detail: JSON.stringify({ dataMode: form.dataMode, unchanged: true })
				});
			}
			const feedback: DatabaseFeedback = {
				section: 'database',
				action: 'switch',
				ok: true,
				switched: {
					backend: result.backend,
					location: maskConfig(config),
					copied: result.copied,
					dataMode: form.dataMode
				},
				// No URL here: only the non-secret form values.
				values: form.values
			};
			return feedback;
		} catch (error) {
			// Log only scrubbed text: driver errors may embed the connection string.
			console.error(
				'[admin] backend switch failed:',
				describeError(error, { exposeErrors: true, secrets: form.secrets })
			);
			return databaseFailure('switch', form, error);
		}
	},

	/** Saves the registration policy. */
	updateSettings: async ({ locals, request }) => {
		const user = requireRole(locals, 'admin');
		const data = await request.formData();
		const allowRegistration = readCheckbox(data, 'allowRegistration');
		const defaultRole = readString(data, 'defaultRole', 20);
		if (!isRole(defaultRole)) {
			const feedback: SettingsFeedback = {
				section: 'settings',
				ok: false,
				message: 'Choose a valid role.'
			};
			return fail(400, feedback);
		}
		try {
			const db = await getDatabase();
			const before = await getAuthSettings(db);
			// Throws AuthError('invalid_input') for `admin`: open registration must not mint admins.
			const settings = await updateAuthSettings(db, { allowRegistration, defaultRole });
			const changes: string[] = [];
			if (before.allowRegistration !== settings.allowRegistration) {
				changes.push(`allowRegistration ${before.allowRegistration}→${settings.allowRegistration}`);
			}
			if (before.defaultRole !== settings.defaultRole) {
				changes.push(`defaultRole ${before.defaultRole}→${settings.defaultRole}`);
			}
			await recordAudit(db, {
				actor: auditActor(user),
				action: 'settings_update',
				target: 'auth',
				detail: changes.join(', ') || 'no changes'
			});
			const feedback: SettingsFeedback = {
				section: 'settings',
				ok: true,
				message: 'Settings saved.',
				settings
			};
			return feedback;
		} catch (error) {
			console.error('[admin] settings update failed:', error);
			const feedback: SettingsFeedback = {
				section: 'settings',
				ok: false,
				message: describeError(error, { fallback: 'The settings could not be saved.' })
			};
			return fail(400, feedback);
		}
	}
};
