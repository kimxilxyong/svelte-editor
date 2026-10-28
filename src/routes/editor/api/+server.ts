import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseBuilderBlocks } from '../../../lib/editor.js';
import {
	createTables,
	getSavedPage,
	hasEditorPageTable,
	savePage
} from '../../../lib/server/db/index.js';

export const GET: RequestHandler = async () => {
	try {
		const created = hasEditorPageTable();
		return json({
			created,
			blocks: created ? await getSavedPage() : null
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
		const blocks = parseBuilderBlocks('blocks' in body ? body.blocks : null);
		if (!blocks) {
			return json(
				{ error: 'The page contains invalid or unsupported components.' },
				{ status: 400 }
			);
		}
		if (!hasEditorPageTable()) {
			return json({ error: 'Create the SQLite tables before saving the page.' }, { status: 409 });
		}

		try {
			await savePage(blocks);
			return json({ success: true });
		} catch (error) {
			console.error('Unable to save the editor page to SQLite.', error);
			return json({ error: 'Unable to save the page to SQLite.' }, { status: 500 });
		}
	}

	return json({ error: 'Unsupported action.' }, { status: 400 });
};
