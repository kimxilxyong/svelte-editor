/**
 * @fileoverview Root layout server load: exposes the signed-in user and the active project to every page.
 *
 * `hooks.server.ts` resolves the session into `locals.user` and the validated `active_project` cookie
 * into `locals.project`; this passes the minimal, secret-free {@link SessionUser} (id, email, name,
 * role), the active {@link ProjectSummary} and a short list of the user's projects (for the
 * navigation's project switcher) to the client.
 */

import type { LayoutServerLoad } from './$types';
import {
	builtInThemes,
	defaultSiteTheme,
	type ManagedTheme,
	type SiteTheme
} from '../lib/theme.js';
import type { ManagedImage } from '../lib/images.js';
import { getDatabase } from '../lib/server/database/manager.js';
import { listImages, listProjects, listThemes } from '../lib/server/project-store.js';

/** One entry of the navigation's project switcher. */
export type NavProject = { id: string; name: string; ownerName: string; own: boolean };

/**
 * @returns `{ user, project, navProjects, siteTheme, themes, images }` – the current user (`null`
 * when anonymous), the active project (`null` when the user has none), the user's own projects
 * (plus the active one when an admin works in somebody else's), the active project's theme, the
 * managed theme library and the managed image catalog.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user ?? null;
	const project = locals.project ?? null;
	const siteTheme: SiteTheme = project ? project.theme : { ...defaultSiteTheme };

	let projects: NavProject[] = [];
	let themes: ManagedTheme[] = builtInThemes.map((item) => ({
		...item,
		builtIn: true,
		createdAt: '',
		updatedAt: ''
	}));
	let images: ManagedImage[] = [];
	if (user) {
		try {
			const db = await getDatabase();
			// `role: 'user'` deliberately lists only the user's own projects, also for admins.
			const own = await listProjects(db, { id: user.id, role: 'user' });
			projects = own
				.map((item) => ({ id: item.id, name: item.name, ownerName: item.ownerName, own: true }))
				.sort((a, b) => a.name.localeCompare(b.name));
			if (project && !projects.some((item) => item.id === project.id)) {
				projects.unshift({
					id: project.id,
					name: project.name,
					ownerName: project.ownerName,
					own: false
				});
			}
			themes = await listThemes(db);
			images = await listImages(db);
		} catch {
			// A broken database must not take the whole app down; the switcher is simply empty.
		}
	}
	return { user, project, navProjects: projects, siteTheme, themes, images };
};
