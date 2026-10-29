/**
 * @fileoverview Server module of the user management page (`/admin/users`).
 *
 * - `load`: searchable / filterable / paged user list. The list state lives in the URL search
 *   parameters (parsed with `parseUsersQuery`), so Back/Forward, reloads and shared links work.
 * - `actions`: `create`, `update`, `setRole`, `resetPassword`, `delete`.
 *
 * ## Security model
 * - Every `load` and action calls `requireRole(locals, 'admin')` in addition to the hook, and the
 *   acting administrator is always `locals.user` – never a form field.
 * - Business rules (last active admin protection, unique emails, password policy) are enforced by
 *   `users.ts`; failures surface as `AuthError` messages which are safe to display.
 * - Administrators cannot lock themselves out: changing **their own** role to a lower one,
 *   disabling or deleting themselves is refused here (another admin has to do it).
 * - Passwords come from the POST body only and are never echoed back (`values` has no password).
 *
 * ## Audit (who records what)
 * `updateUser` → `user_update`, `deleteUser` → `user_delete` (recorded inside `users.ts`);
 * this module records `user_create` and `password_reset`.
 */

import { fail, redirect } from '@sveltejs/kit';
import { isRole, type Role } from '../../../lib/auth/roles.js';
import { parseUsersQuery, usersQueryToSearch } from '../../../lib/admin/users-query.js';
import type { UserActionFeedback } from '../../../lib/admin/types.js';
import {
	auditActor,
	describeError,
	readString,
	statusForAuthError
} from '../../../lib/server/admin/helpers.js';
import { recordAudit } from '../../../lib/server/auth/audit.js';
import { requireRole } from '../../../lib/server/auth/guard.js';
import {
	createUser,
	deleteUser,
	getUserById,
	listUsers,
	setUserPassword,
	updateUser,
	type UserPatch
} from '../../../lib/server/auth/users.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import type { Actions, PageServerLoad } from './$types';

/** Short display label of a user for messages and audit targets. */
function labelOf(user: { email: string | null; name: string }): string {
	return user.email ?? user.name;
}

/**
 * Builds the `fail()` result of a user action. Expected {@link AuthError}s are shown as they are;
 * anything unexpected is logged and replaced by a generic message (no internals leak).
 */
function failure(
	action: UserActionFeedback['action'],
	error: unknown,
	extra: Pick<UserActionFeedback, 'userId' | 'values'> = {}
) {
	const status = statusForAuthError(error);
	if (status === 500) console.error(`[admin/users] ${action} failed:`, error);
	const feedback: UserActionFeedback = {
		section: 'users',
		action,
		ok: false,
		message: describeError(error, {
			fallback: 'The action failed unexpectedly. Please try again.'
		}),
		...extra
	};
	return fail(status, feedback);
}

/** Builds a `fail()` result for plain validation messages. */
function invalid(
	action: UserActionFeedback['action'],
	message: string,
	extra: Pick<UserActionFeedback, 'userId' | 'values'> = {},
	status = 400
) {
	const feedback: UserActionFeedback = { section: 'users', action, ok: false, message, ...extra };
	return fail(status, feedback);
}

/** Builds a success result. */
function done(
	action: UserActionFeedback['action'],
	message: string,
	userId?: string
): UserActionFeedback {
	return { section: 'users', action, ok: true, message, userId };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const admin = requireRole(locals, 'admin');
	const db = await getDatabase();
	const query = parseUsersQuery(url.searchParams);
	const options = {
		search: query.q || undefined,
		role: query.role || undefined,
		status: query.status || undefined,
		limit: query.pageSize
	};
	const result = await listUsers(db, { ...options, offset: (query.page - 1) * query.pageSize });

	// A stale link (page beyond the end, e.g. after deleting the last row of a page): canonicalise
	// to the last existing page instead of showing an empty table.
	if (result.users.length === 0 && result.total > 0 && query.page > 1) {
		const lastPage = Math.ceil(result.total / query.pageSize);
		redirect(303, `${url.pathname}${usersQueryToSearch(query, { page: lastPage })}`);
	}

	return {
		users: result.users,
		total: result.total,
		query,
		currentUserId: admin.id
	};
};

export const actions: Actions = {
	/** Creates an account with a password (admins may assign any role, including admin). */
	create: async ({ locals, request }) => {
		const actor = requireRole(locals, 'admin');
		const data = await request.formData();
		const name = readString(data, 'name', 200).trim();
		const email = readString(data, 'email', 400).trim();
		const password = readString(data, 'password', 400);
		const role = readString(data, 'role', 20);
		// Never echo the password back; only these non-secret values re-populate the form.
		const values = { name, email, role };
		if (!isRole(role)) return invalid('create', 'Choose a valid role.', { values });
		try {
			const db = await getDatabase();
			const created = await createUser(db, { email: email || null, name, password, role });
			await recordAudit(db, {
				actor: auditActor(actor),
				action: 'user_create',
				target: labelOf(created),
				detail: `role ${role}`
			});
			return done('create', `Created ${labelOf(created)}.`, created.id);
		} catch (error) {
			return failure('create', error, { values });
		}
	},

	/** Edits name, email, role and enabled/disabled state (`updateUser` audits `user_update`). */
	update: async ({ locals, request }) => {
		const actor = requireRole(locals, 'admin');
		const data = await request.formData();
		const id = readString(data, 'id', 100);
		const patch: UserPatch = {};
		const name = readString(data, 'name', 200).trim();
		const email = readString(data, 'email', 400).trim();
		const role = readString(data, 'role', 20);
		const status = readString(data, 'status', 20);
		if (name) patch.name = name;
		// An empty email field means "unchanged" (wallet-only accounts have none).
		if (email) patch.email = email;
		if (role) {
			if (!isRole(role)) return invalid('update', 'Choose a valid role.', { userId: id });
			patch.role = role;
		}
		if (status === 'disabled') patch.disabled = true;
		else if (status === 'active') patch.disabled = false;
		if (id === actor.id && ((patch.role && patch.role !== actor.role) || patch.disabled === true)) {
			return invalid(
				'update',
				'You cannot change your own role or disable your own account. Ask another admin.',
				{ userId: id },
				403
			);
		}
		try {
			const db = await getDatabase();
			const updated = await updateUser(db, id, patch, actor.id);
			return done('update', `Saved changes for ${labelOf(updated)}.`, id);
		} catch (error) {
			return failure('update', error, { userId: id });
		}
	},

	/** Changes only the role (inline select in the table). */
	setRole: async ({ locals, request }) => {
		const actor = requireRole(locals, 'admin');
		const data = await request.formData();
		const id = readString(data, 'id', 100);
		const role = readString(data, 'role', 20);
		if (!isRole(role)) return invalid('setRole', 'Choose a valid role.', { userId: id });
		if (id === actor.id && role !== actor.role) {
			return invalid(
				'setRole',
				'You cannot change your own role. Ask another admin.',
				{ userId: id },
				403
			);
		}
		try {
			const db = await getDatabase();
			const updated = await updateUser(db, id, { role: role as Role }, actor.id);
			return done('setRole', `${labelOf(updated)} is now ${role}.`, id);
		} catch (error) {
			return failure('setRole', error, { userId: id });
		}
	},

	/**
	 * Sets a new password chosen by the admin and signs the user out everywhere (sessions are
	 * revoked, except the admin's own current session when they reset their own password).
	 */
	resetPassword: async ({ locals, request }) => {
		const actor = requireRole(locals, 'admin');
		const data = await request.formData();
		const id = readString(data, 'id', 100);
		const password = readString(data, 'password', 400);
		try {
			const db = await getDatabase();
			const target = await getUserById(db, id);
			if (!target) return invalid('resetPassword', 'User not found.', { userId: id }, 404);
			await setUserPassword(db, id, password, {
				revokeSessions: true,
				exceptSessionId: id === actor.id ? (locals.sessionId ?? undefined) : undefined
			});
			await recordAudit(db, {
				actor: auditActor(actor),
				action: 'password_reset',
				target: labelOf(target),
				detail: 'sessions revoked'
			});
			return done('resetPassword', `Password for ${labelOf(target)} was reset.`, id);
		} catch (error) {
			return failure('resetPassword', error, { userId: id });
		}
	},

	/** Permanently deletes a user (`deleteUser` enforces the rules and audits `user_delete`). */
	delete: async ({ locals, request }) => {
		const actor = requireRole(locals, 'admin');
		const data = await request.formData();
		const id = readString(data, 'id', 100);
		if (id === actor.id) {
			return invalid('delete', 'You cannot delete your own account here.', { userId: id }, 403);
		}
		try {
			const db = await getDatabase();
			const target = await getUserById(db, id);
			await deleteUser(db, id, actor.id);
			return done('delete', `Deleted ${target ? labelOf(target) : 'the user'}.`, id);
		} catch (error) {
			return failure('delete', error, { userId: id });
		}
	}
};
