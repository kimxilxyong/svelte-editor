/**
 * @fileoverview Site persistence API of the **active project**.
 *
 * - `GET /editor/api` → `{ project: { id, name } | null, site }`. `site` holds the pages and
 *   composites of the active project (both empty for a fresh project, or while the user has no project).
 * - `POST /editor/api` with `{ action: 'save', site }` validates the site and replaces the pages and
 *   composites of the active project.
 *
 * The project is always `locals.project` (resolved and ownership-checked in `hooks.server.ts`); a
 * project id in the request is never read, so one user can not write into another user's project.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../lib/editor.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import { loadSite, saveSite } from '../../../lib/server/project-store.js';

export const GET: RequestHandler = async ({ locals }) => {
	const project = locals.project;
	if (!project) {
		return json({ project: null, site: { pages: [], composites: [] } });
	}
	try {
		const site = await loadSite(await getDatabase(), project.id);
		return json({ project: { id: project.id, name: project.name }, site });
	} catch (error) {
		console.error('Unable to load the project site.', error);
		return json({ error: 'Unable to load the project from the database.' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null || Array.isArray(body) || !('action' in body)) {
		return json({ error: 'The request must include an action.' }, { status: 400 });
	}

	if (body.action === 'save') {
		const project = locals.project;
		if (!project) {
			return json({ error: 'Create or open a project before saving.' }, { status: 409 });
		}
		const site = parseEditorSite('site' in body ? body.site : null);
		if (!site) {
			return json(
				{ error: 'The site contains invalid pages, links or components.' },
				{ status: 400 }
			);
		}
		try {
			await saveSite(await getDatabase(), project.id, site);
			return json({ success: true });
		} catch (error) {
			console.error('Unable to save the project site.', error);
			return json({ error: 'Unable to save the project to the database.' }, { status: 500 });
		}
	}

	return json({ error: 'Unknown action.' }, { status: 400 });
};
