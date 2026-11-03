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
import {
	createManagedTheme,
	deleteManagedTheme,
	listThemes,
	ProjectStoreError,
	updateManagedTheme,
	updateProject
} from '../../lib/server/project-store.js';
import type { Actions, PageServerLoad } from './$types';

/** @returns `{ canEdit, themes }` – whether the signed-in user may manage themes and the library of themes. */
export const load: PageServerLoad = async ({ locals }) => ({
	canEdit: hasRole(locals.user?.role, 'poweruser'),
	themes: await listThemes(await getDatabase())
});

export const actions: Actions = {
	/**
	 * Validates the JSON in the `theme` form field, updates/creates the managed theme if `themeId` or
	 * `themeName` is provided, and stores it as the active project's theme when a project is open.
	 */
	save: async ({ request, locals }) => {
		requireRole(locals, 'poweruser');
		const form = await request.formData();
		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('theme') ?? ''));
		} catch {
			return fail(400, { error: 'The theme could not be read.' });
		}
		const themeId = String(form.get('themeId') ?? '').trim();
		const themeName = String(form.get('themeName') ?? '').trim();
		const db = await getDatabase();
		try {
			if (themeId) {
				await updateManagedTheme(db, themeId, {
					...(themeName ? { name: themeName } : {}),
					theme: payload
				});
			} else if (themeName) {
				await createManagedTheme(db, { name: themeName, theme: payload });
			}
			if (locals.project) {
				await updateProject(db, locals.project.id, { theme: payload as SiteTheme });
			}
		} catch (error) {
			return fail(400, {
				error: error instanceof ProjectStoreError ? error.message : 'The theme is invalid.'
			});
		}
		return { saved: true };
	},
	/** Creates a new named theme in the managed themes library. */
	create: async ({ request, locals }) => {
		requireRole(locals, 'poweruser');
		const form = await request.formData();
		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('theme') ?? ''));
		} catch {
			return fail(400, { error: 'The theme could not be read.' });
		}
		const themeName = String(form.get('themeName') ?? '').trim();
		const db = await getDatabase();
		try {
			const created = await createManagedTheme(db, { name: themeName, theme: payload });
			if (locals.project) {
				await updateProject(db, locals.project.id, { theme: created.theme });
			}
			return { saved: true, createdId: created.id };
		} catch (error) {
			return fail(400, {
				error: error instanceof ProjectStoreError ? error.message : 'Could not create theme.'
			});
		}
	},
	/** Deletes a managed theme from the library. */
	delete: async ({ request, locals }) => {
		requireRole(locals, 'poweruser');
		const form = await request.formData();
		const themeId = String(form.get('themeId') ?? '').trim();
		try {
			await deleteManagedTheme(await getDatabase(), themeId);
			return { deleted: true };
		} catch (error) {
			return fail(400, {
				error: error instanceof ProjectStoreError ? error.message : 'Could not delete theme.'
			});
		}
	}
};
