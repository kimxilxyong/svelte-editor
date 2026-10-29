/**
 * @fileoverview SQLite Persistence Layer for the SvelteKit Page Editor.
 *
 * Utilizes Node.js native `DatabaseSync` (`node:sqlite`) and Drizzle ORM to persist
 * editor sites.
 *
 * Architecture & Compatibility:
 * - Current sites are stored under the row key `id = 'site'`.
 * - Backward compatibility: If no `site` record exists, it attempts to load `id = 'home'`
 *   (the legacy format from earlier versions). If that record holds a flat array of blocks,
 *   it automatically wraps it into a single-page `EditorSite` titled 'Home' at slug `/home`.
 */

import { drizzle } from 'drizzle-orm-node-sqlite';
import { DatabaseSync } from 'node:sqlite';
import * as schema from './schema.js';
import { parseBuilderBlocks, parseEditorSite, type EditorSite } from '../../editor.js';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

/** Synchronous SQLite client instance. */
const client = new DatabaseSync(DATABASE_URL);

/** Drizzle ORM database instance configured with our schema. */
export const db = drizzle({ client, schema });

/**
 * Initializes the database schema by executing CREATE TABLE IF NOT EXISTS statements.
 * Creates the `editor_page` storage table and `task` table.
 */
export function createTables(): void {
	client.exec(`
		CREATE TABLE IF NOT EXISTS task (
			id TEXT PRIMARY KEY NOT NULL,
			title TEXT NOT NULL,
			priority INTEGER NOT NULL DEFAULT 1
		);
		CREATE TABLE IF NOT EXISTS editor_page (
			id TEXT PRIMARY KEY NOT NULL,
			blocks TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
}

/**
 * Checks whether the `editor_page` database table has been created.
 *
 * @returns `true` if table exists in `sqlite_master`.
 */
export function hasEditorPageTable(): boolean {
	return (
		client
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get('editor_page') !== undefined
	);
}

/**
 * Retrieves the currently saved EditorSite from SQLite.
 *
 * Checks `id = 'site'` first, falling back to legacy `id = 'home'`.
 *
 * @returns Parsed EditorSite or `null` if no site has been saved yet.
 * @throws {Error} If database content is corrupt or fails validation.
 */
export function getSavedSite(): EditorSite | null {
	const saved =
		client.prepare('SELECT blocks FROM editor_page WHERE id = ?').get('site') ??
		client.prepare('SELECT blocks FROM editor_page WHERE id = ?').get('home');
	if (!saved) return null;
	if (typeof saved.blocks !== 'string') {
		throw new Error('The saved editor page does not contain valid data.');
	}

	const parsed: unknown = JSON.parse(saved.blocks);
	// Pages saved before multi-page support are a bare array of blocks.
	if (Array.isArray(parsed)) {
		const blocks = parseBuilderBlocks(parsed);
		if (!blocks) throw new Error('The saved editor page contains invalid block data.');
		return {
			pages: [{ id: 'home', name: 'Home', slug: 'home', width: 800, height: 600, blocks }]
		};
	}

	const site = parseEditorSite(parsed);
	if (!site) throw new Error('The saved editor site contains invalid data.');
	return site;
}

/**
 * Persists an EditorSite to SQLite under the record ID `'site'`.
 *
 * Uses `ON CONFLICT (id) DO UPDATE` to perform an upsert.
 *
 * @param site - EditorSite model to serialize and save.
 */
export function saveSite(site: EditorSite): void {
	client
		.prepare(
			`INSERT INTO editor_page (id, blocks, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET
				blocks = excluded.blocks,
				updated_at = excluded.updated_at`
		)
		.run('site', JSON.stringify(site), new Date().toISOString());
}
