/**
 * @fileoverview `/theme` – load and save the theme of the **active project**.
 *
 * Every signed-in role may open the page (to see the live preview); saving needs `poweruser`. The
 * access table in `auth/roles.ts` already enforces this for the POST, and the action calls
 * {@link requireRole} again as defence in depth. The theme itself (`project.theme`) is read for every
 * page by the root layout, so this load only reports whether the current user may edit. Without an
 * active project there is nothing to edit.
 */

import { fail } from '@sveltejs/kit';
import type { SiteTheme } from '../../lib/theme.js';
import { hasRole } from '../../lib/auth/roles.js';
import { getDatabase } from '../../lib/server/database/manager.js';
import { requireRole } from '../../lib/server/auth/guard.js';
import { updateProject } from '../../lib/server/project-store.js';
import type { Actions, PageServerLoad } from './$types';

/** @returns `{ canEdit }` – whether the signed-in user may save a new theme for the active project. */
export const load: PageServerLoad = ({ locals }) => ({
	canEdit: hasRole(locals.user?.role, 'poweruser') && locals.project !== null
});

export const actions: Actions = {
	/** Validates the JSON in the `theme` form field and stores it as the active project's theme. */
	save: async ({ request, locals }) => {
		requireRole(locals, 'poweruser');
		const project = locals.project;
		if (!project) return fail(409, { error: 'Create or open a project first.' });
		const form = await request.formData();
		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('theme') ?? ''));
		} catch {
			return fail(400, { error: 'The theme could not be read.' });
		}
		try {
			await updateProject(await getDatabase(), project.id, { theme: payload as SiteTheme });
		} catch {
			return fail(400, { error: 'The theme is invalid.' });
		}
		return { saved: true };
	}
};
