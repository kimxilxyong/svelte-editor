/**
 * @fileoverview Asynchronous editor persistence facade over the selected portable database backend.
 *
 * The editor continues to store its serialized site in `editor_page`; backend selection, schema
 * initialization and connection ownership belong to `database/manager.ts`. Older single-page saves
 * under `id = 'home'` remain readable for backwards compatibility, and sites saved before composite
 * components existed are migrated (and re-saved) on first read by `site-migration.ts`.
 */

import { parseEditorSite, type EditorSite } from '../../editor.js';
import { migrateSiteData } from '../../site-migration.js';
import { ensureSchema } from '../database/schema.js';
import { getDatabase } from '../database/manager.js';
import type { SqlRow } from '../database/types.js';

/**
 * Ensures all application tables exist on the active backend.
 *
 * @returns A promise that resolves after the shared schema is ensured.
 * @throws {Error} If the active database cannot be initialized or updated.
 * @example
 * await createTables();
 */
export async function createTables(): Promise<void> {
	await ensureSchema(await getDatabase());
}

/**
 * Checks whether editor-page storage is available on the active backend.
 *
 * The manager ensures the shared schema before returning its client, and this zero-row query also
 * verifies that the editor table can be read without depending on SQLite-only catalog tables.
 *
 * @returns `true` when the `editor_page` table is readable.
 * @throws {Error} If the active database cannot be initialized or queried.
 * @example
 * const available = await hasEditorPageTable();
 */
export async function hasEditorPageTable(): Promise<boolean> {
	const db = await getDatabase();
	await db.all('SELECT id FROM editor_page LIMIT 0');
	return true;
}

/**
 * Retrieves the saved EditorSite from the active database.
 *
 * Checks `id = 'site'` first, falling back to legacy `id = 'home'`. Flat arrays from older builds
 * are wrapped into the single-page Home site format.
 *
 * @returns Parsed EditorSite or `null` if no site has been saved yet.
 * @throws {Error} If stored JSON is corrupt or fails editor-site validation.
 * @example
 * const site = await getSavedSite();
 */
export async function getSavedSite(): Promise<EditorSite | null> {
	const db = await getDatabase();
	const saved =
		(await db.get<SqlRow>('SELECT blocks FROM editor_page WHERE id = ?', ['site'])) ??
		(await db.get<SqlRow>('SELECT blocks FROM editor_page WHERE id = ?', ['home']));
	if (!saved) return null;
	if (typeof saved.blocks !== 'string') {
		throw new Error('The saved editor page does not contain valid data.');
	}

	let parsed: unknown = JSON.parse(saved.blocks);
	if (Array.isArray(parsed)) {
		// Legacy flat block list: wrap it into a single Home page first, then migrate like any site.
		parsed = {
			pages: [{ id: 'home', name: 'Home', slug: 'home', width: 1920, height: 1080, blocks: parsed }]
		};
	}

	// Pre-composite sites (fixed section kinds, no `composites`) are rewritten once and persisted.
	const migration = migrateSiteData(parsed);
	const site = parseEditorSite(migration.data);
	if (!site) throw new Error('The saved editor site contains invalid data.');
	if (migration.changed) await saveSite(site);
	return site;
}

/**
 * Persists an EditorSite on the active backend under record ID `site`.
 *
 * @param site - Validated editor-site model to serialize and save.
 * @returns A promise that resolves after the upsert completes.
 * @throws {Error} If serialization or persistence fails.
 * @example
 * await saveSite(site);
 */
export async function saveSite(site: EditorSite): Promise<void> {
	const db = await getDatabase();
	await db.run(
		`INSERT INTO editor_page (id, blocks, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			blocks = excluded.blocks,
			updated_at = excluded.updated_at`,
		['site', JSON.stringify(site), new Date().toISOString()]
	);
}
