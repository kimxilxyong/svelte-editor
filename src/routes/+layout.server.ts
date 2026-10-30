/**
 * @fileoverview Root layout server load: exposes the signed-in user to every page.
 *
 * `hooks.server.ts` resolves the session into `locals.user`; this passes the minimal, secret-free
 * {@link SessionUser} (id, email, name, role) to the client so the header and navigation can adapt.
 */

import type { LayoutServerLoad } from './$types';
import { defaultSiteTheme, type SiteTheme } from '../lib/theme.js';
import { getDatabase } from '../lib/server/database/manager.js';
import { getSiteTheme } from '../lib/server/theme.js';

/**
 * @returns `{ user, siteTheme }` – the current user (`null` when anonymous) and the site-wide
 * theme applied to the canvas, previews and exports (the default when the database is unavailable).
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	let siteTheme: SiteTheme = { ...defaultSiteTheme };
	try {
		siteTheme = await getSiteTheme(await getDatabase());
	} catch {
		// A broken database must not take the whole app down; the default theme is used instead.
	}
	return { user: locals.user ?? null, siteTheme };
};
