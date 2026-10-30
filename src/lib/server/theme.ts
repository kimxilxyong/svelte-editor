/**
 * @fileoverview Persistence of the site-wide {@link SiteTheme} in the `app_settings` key/value table
 * (key `site.theme`, JSON text). Uses the portable SQL dialect only, so it works on both the SQLite
 * and the PostgreSQL backend.
 *
 * Interacts with:
 * - `auth/settings.ts` – `getSetting` / `setSetting` primitives.
 * - `routes/+layout.server.ts` – loads the theme for every page; `routes/theme/+page.server.ts` saves it.
 */

import { defaultSiteTheme, parseSiteTheme, type SiteTheme } from '../theme.js';
import { getSetting, setSetting } from './auth/settings.js';
import type { SqlClient } from './database/types.js';

const KEY_SITE_THEME = 'site.theme';

/**
 * Loads the stored theme.
 *
 * @param db - Database client.
 * @returns The stored theme, or {@link defaultSiteTheme} when nothing valid is stored.
 */
export async function getSiteTheme(db: SqlClient): Promise<SiteTheme> {
	const raw = await getSetting(db, KEY_SITE_THEME);
	if (raw) {
		try {
			const parsed = parseSiteTheme(JSON.parse(raw));
			if (parsed) return parsed;
		} catch {
			// Corrupt JSON falls through to the default.
		}
	}
	return { ...defaultSiteTheme };
}

/**
 * Validates and stores a theme.
 *
 * @param db - Database client.
 * @param value - Untrusted theme payload.
 * @returns The stored (normalised) theme.
 * @throws {Error} When the payload is not a valid {@link SiteTheme}.
 */
export async function saveSiteTheme(db: SqlClient, value: unknown): Promise<SiteTheme> {
	const theme = parseSiteTheme(value);
	if (!theme) throw new Error('Invalid theme.');
	await setSetting(db, KEY_SITE_THEME, JSON.stringify(theme));
	return theme;
}
