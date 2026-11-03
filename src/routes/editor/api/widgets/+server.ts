/**
 * @fileoverview Built-in widget override API.
 *
 * Widget edits belong to the **active project** (`locals.project`): they are stored per project in
 * `.data/widgets/<projectId>/`, so other users and projects never see them.
 *
 * - `GET  /editor/api/widgets` → `{ overrides: { [ComponentName]: source } }` of the active project;
 *   read by the canvas, the pages view and the theme page so edited widgets render everywhere (any
 *   signed-in role). Without a project the result is empty.
 * - `POST /editor/api/widgets` with `action`: `list` | `read` | `save` | `reset` (power users
 *   only, re-checked here in addition to the global access policy; a project is required).
 *
 * File handling lives in `lib/server/widget-files.ts`.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '../../../../lib/server/auth/guard.js';
import {
	listWidgets,
	readOverrides,
	readWidget,
	resetWidget,
	saveWidget,
	WidgetError
} from '../../../../lib/server/widget-files.js';

export const GET: RequestHandler = async ({ locals }) =>
	json({ overrides: locals.project ? await readOverrides(locals.project.id) : {} });

export const POST: RequestHandler = async ({ request, locals }) => {
	requireRole(locals, 'poweruser');
	const project = locals.project;
	if (!project) return json({ error: 'Create or open a project first.' }, { status: 409 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}
	const { action, name, content, force } = body as Record<string, unknown>;
	try {
		if (action === 'list') return json({ widgets: await listWidgets(project.id) });
		if (action === 'read') return json({ content: await readWidget(name, project.id) });
		if (action === 'save') return json(await saveWidget(name, content, force === true, project.id));
		if (action === 'reset') {
			await resetWidget(name, project.id);
			return json({ reset: true });
		}
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof WidgetError) return json({ error: error.message }, { status: 400 });
		console.error('Widget request failed.', error);
		return json({ error: 'The widget could not be read or written.' }, { status: 500 });
	}
};
