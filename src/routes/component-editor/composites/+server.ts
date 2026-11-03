/**
 * @fileoverview Active-project native composite code API; no filesystem access or body project ids.
 * POST list/read/save/reset actions use project-store exclusively. Hooks require poweruser for this
 * route prefix; requireRole and an accessible-project lookup repeat that check in depth. Save/reset
 * require the read revision and update only the target composite, never a stale whole-site snapshot.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '../../../lib/server/auth/guard.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	getAccessibleProject,
	loadSite,
	ProjectStoreError,
	readCompositeSource,
	saveCompositeSource
} from '../../../lib/server/project-store.js';

/** Dispatches revision-guarded native-source actions for the ownership-checked active project. */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireRole(locals, 'poweruser');
	const db = await getDatabase();
	const project =
		locals.project && locals.user
			? await getAccessibleProject(db, locals.user, locals.project.id)
			: null;
	if (!project) return json({ error: 'Create or open a project first.' }, { status: 409 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}
	const { action, id, content, revision, force } = body as Record<string, unknown>;
	try {
		if (action === 'list') return json({ composites: (await loadSite(db, project.id)).composites });
		if (typeof id !== 'string' || !id || id.length > 100) {
			return json({ error: 'Choose a composite.' }, { status: 400 });
		}
		if (action === 'read') return json(await readCompositeSource(db, project.id, id));
		if (action === 'save' || action === 'reset') {
			if (action === 'save' && typeof content !== 'string') {
				return json({ error: 'Composite source must be text.' }, { status: 400 });
			}
			return json(
				await saveCompositeSource(
					db,
					project.id,
					id,
					action === 'reset' ? undefined : content,
					revision,
					force === true
				)
			);
		}
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectStoreError)
			return json(
				{ error: error.message },
				{
					status: error.code === 'conflict' ? 409 : error.code === 'not_found' ? 404 : 400
				}
			);
		console.error('Composite source request failed.', error);
		return json({ error: 'The composite could not be read or written.' }, { status: 500 });
	}
};
