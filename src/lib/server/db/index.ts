import { drizzle } from 'drizzle-orm-node-sqlite';
import { DatabaseSync } from 'node:sqlite';
import * as schema from './schema';
import { parseBuilderBlocks, parseEditorSite, type EditorSite } from '../../editor.js';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new DatabaseSync(DATABASE_URL);

export const db = drizzle({ client, schema });

export function createTables() {
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

export function hasEditorPageTable() {
	return (
		client
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get('editor_page') !== undefined
	);
}

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

export function saveSite(site: EditorSite) {
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
