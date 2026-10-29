import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../lib/editor.js';
import {
	createTables,
	getSavedSite,
	hasEditorPageTable,
	saveSite
} from '../../../lib/server/db/index.js';

export const GET: RequestHandler = async () => {
	try {
		const created = hasEditorPageTable();
		return json({
			created,
			site: created ? getSavedSite() : null
		});
	} catch (error) {
		console.error('Unable to load the saved editor page.', error);
		return json({ error: 'Unable to load the saved page from SQLite.' }, { status: 500 });
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
		try {
			createTables();
			return json({ success: true });
		} catch (error) {
			console.error('Unable to create SQLite tables for the page editor.', error);
			return json({ error: 'Unable to create the SQLite tables.' }, { status: 500 });
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
		if (!hasEditorPageTable()) {
			return json({ error: 'Create the SQLite tables before saving the page.' }, { status: 409 });
		}

		try {
			saveSite(site);
			return json({ success: true });
		} catch (error) {
			console.error('Unable to save the editor page to SQLite.', error);
			return json({ error: 'Unable to save the page to SQLite.' }, { status: 500 });
		}
	}

	return json({ error: 'Unsupported action.' }, { status: 400 });
};
