/**
 * @fileoverview `/setup` – first-run creation of the initial administrator.
 *
 * Only reachable while the `users` table is empty (`needsSetup`). `hooks.server.ts` already sends
 * anonymous visitors here during first run and bounces `/setup` to `/login` afterwards; the load
 * function and the action repeat the check because the hook is a convenience layer, not the only
 * line of defence (and a concurrent second submit must not create a second admin –
 * `createInitialAdmin` is serialised and re-checks inside).
 *
 * ## Security decisions
 * - **Trust on first use:** whoever reaches `/setup` first becomes the administrator. Deploy and
 *   open the page immediately; there is deliberately no setup token because the operator controls
 *   the first request.
 * - **No JSON error leak:** failures return field errors / a fixed message, never stack traces.
 * - **Session fixation:** `establishSession` issues a fresh session for the new admin.
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { AuthError } from '../../lib/server/auth/errors.js';
import { createInitialAdmin, needsSetup } from '../../lib/server/auth/flow.js';
import { establishSession } from '../../lib/server/auth/login.js';
import { parseSignupForm, type SignupFieldErrors } from '../../lib/server/auth/signup-form.js';
import { getDatabase } from '../../lib/server/database/manager.js';

export const load: PageServerLoad = async ({ locals }) => {
	const db = await getDatabase();
	if (locals.user || !(await needsSetup(db))) redirect(303, locals.user ? '/' : '/login');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const db = await getDatabase();
		if (!(await needsSetup(db))) redirect(303, '/login');

		const parsed = parseSignupForm(await event.request.formData());
		if (!parsed.ok) return fail(400, { values: parsed.values, errors: parsed.errors });

		try {
			const admin = await createInitialAdmin(db, parsed.data);
			await establishSession(event, db, admin.id);
		} catch (error) {
			if (error instanceof AuthError) {
				// Somebody else finished the setup in the meantime.
				if (error.code === 'setup_closed') redirect(303, '/login');
				const values = { name: parsed.data.name, email: parsed.data.email };
				if (error.code === 'weak_password') {
					return fail(400, { values, errors: { password: error.message } as SignupFieldErrors });
				}
				return fail(400, { values, error: error.message });
			}
			throw error;
		}
		redirect(303, '/');
	}
};
