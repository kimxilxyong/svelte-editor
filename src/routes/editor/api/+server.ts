/**
 * @fileoverview Editor persistence API endpoint backed by the selected database implementation.
 *
 * `GET /editor/api` reports schema and saved-site state. `POST` supports initializing the shared
 * schema and validating/upserting serialized editor sites without assuming a specific SQL backend.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../lib/editor.js';
import {
	createTables,
	getSavedSite,
	hasEditorPageTable,
	saveSite
} from '../../../lib/server/db/index.js';
import { getDatabase } from '../../../lib/server/database/manager.js';

function backendLabel(backend: 'sqlite' | 'postgres'): string {
	return backend === 'postgres' ? 'PostgreSQL' : 'SQLite';
}

export const GET: RequestHandler = async () => {
	let backend = 'database';
	try {
		const client = await getDatabase();
		backend = backendLabel(client.backend);
		const created = await hasEditorPageTable();
		return json({
			created,
			site: created ? await getSavedSite() : null
		});
	} catch (error) {
		console.error(`Unable to load the saved editor page from ${backend}.`, error);
		return json({ error: `Unable to load the saved page from ${backend}.` }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null || Array.isArray(body) || !('action' in body)) {
		return json({ error: 'The request must include an action.' }, { status: 400 });
	}

	if (body.action === 'create-tables') {
		let backend = 'database';
		try {
			const client = await getDatabase();
			backend = backendLabel(client.backend);
			await createTables();
			return json({ success: true });
		} catch (error) {
			console.error(`Unable to create ${backend} tables for the page editor.`, error);
			return json({ error: `Unable to create the ${backend} tables.` }, { status: 500 });
		}
	}

	if (body.action === 'save') {
		const site = parseEditorSite('site' in body ? body.site : null);
		if (!site) {
			return json(
				{ error: 'The site contains invalid pages, links or components.' },
				{ status: 400 }
			);
		}

		let backend = 'database';
		try {
			const client = await getDatabase();
			backend = backendLabel(client.backend);
			if (!(await hasEditorPageTable())) {
				return json(
					{ error: `Create the ${backend} tables before saving the page.` },
					{ status: 409 }
				);
			}
			await saveSite(site);
			return json({ success: true });
		} catch (error) {
			console.error(`Unable to save the editor page to ${backend}.`, error);
			return json({ error: `Unable to save the page to ${backend}.` }, { status: 500 });
		}
	}

	return json({ error: 'Unknown action.' }, { status: 400 });
};
