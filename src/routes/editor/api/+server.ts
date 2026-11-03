/**
 * @fileoverview Site persistence API of the **active project**.
 *
 * - `GET /editor/api` → `{ project: { id, name } | null, site, revision }`. `site` holds the pages and
 *   composites of the active project (both empty for a fresh project, or while the user has no project).
 * - `POST /editor/api` with `{ action: 'save', site, revision, expectedProjectId }` rejects stale
 *   drafts and project switches, then replaces the active project's pages and composites atomically.
 *   The client project id is only a precondition and never selects a project.
 *
 * The project is always `locals.project` (resolved and ownership-checked in `hooks.server.ts`); a
 * project id in the request is never read, so one user can not write into another user's project.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../lib/editor.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	loadSiteSnapshot,
	ProjectStoreError,
	saveSite
} from '../../../lib/server/project-store.js';

export const GET: RequestHandler = async ({ locals }) => {
	const project = locals.project;
	if (!project) {
		return json({ project: null, site: { pages: [], composites: [] }, revision: 0 });
	}
	try {
		const { site, revision } = await loadSiteSnapshot(await getDatabase(), project.id);
		return json({ project: { id: project.id, name: project.name }, site, revision });
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
		if (!('expectedProjectId' in body) || body.expectedProjectId !== project.id) {
			return json(
				{ error: 'The active project changed. Reload or reconcile your draft before saving.' },
				{ status: 409 }
			);
		}
		const site = parseEditorSite('site' in body ? body.site : null);
		if (!site) {
			return json(
				{ error: 'The site contains invalid pages, links or components.' },
				{ status: 400 }
			);
		}
		const revision = 'revision' in body ? body.revision : undefined;
		if (!Number.isSafeInteger(revision) || typeof revision !== 'number' || revision < 0) {
			return json(
				{ error: 'Reload the project before saving; the revision is missing.' },
				{ status: 409 }
			);
		}
		try {
			const nextRevision = await saveSite(await getDatabase(), project.id, site, revision);
			return json({ success: true, revision: nextRevision });
		} catch (error) {
			if (error instanceof ProjectStoreError && error.code === 'conflict') {
				return json({ error: error.message }, { status: 409 });
			}
			console.error('Unable to save the project site.', error);
			return json({ error: 'Unable to save the project to the database.' }, { status: 500 });
		}
	}

	return json({ error: 'Unknown action.' }, { status: 400 });
};
