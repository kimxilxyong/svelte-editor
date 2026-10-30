/**
 * @fileoverview `/theme` – load and save the site-wide theme.
 *
 * Every signed-in role may open the page (to see the live preview); saving needs `poweruser`. The
 * access table in `auth/roles.ts` already enforces this for the POST, and the action calls
 * {@link requireRole} again as defence in depth. The theme itself is read for every page by the root
 * layout, so this load only reports whether the current user may edit.
 */

import { fail } from '@sveltejs/kit';
import { hasRole } from '../../lib/auth/roles.js';
import { getDatabase } from '../../lib/server/database/manager.js';
import { requireRole } from '../../lib/server/auth/guard.js';
import { saveSiteTheme } from '../../lib/server/theme.js';
import type { Actions, PageServerLoad } from './$types';

/** @returns `{ canEdit }` – whether the signed-in user may save a new theme. */
export const load: PageServerLoad = ({ locals }) => ({
	canEdit: hasRole(locals.user?.role, 'poweruser')
});

export const actions: Actions = {
	/** Validates the JSON in the `theme` form field and stores it as the site theme. */
	save: async ({ request, locals }) => {
		requireRole(locals, 'poweruser');
		const form = await request.formData();
		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('theme') ?? ''));
		} catch {
			return fail(400, { error: 'The theme could not be read.' });
		}
		try {
			await saveSiteTheme(await getDatabase(), payload);
		} catch {
			return fail(400, { error: 'The theme is invalid.' });
		}
		return { saved: true };
	}
};
