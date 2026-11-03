/**
 * @fileoverview JSON API of the Projects page and the project switcher.
 *
 * - `GET  /projects/api` → `{ projects, activeId }` – the signed-in user's projects (admins: all).
 * - `POST /projects/api` with `action`:
 *   - `create` `{ name, description?, path?, activate? }` → new **empty** project (made active unless
 *     `activate === false`).
 *   - `update` `{ id, name?, description?, path?, theme? }`.
 *   - `delete` `{ id }` – removes the project, its pages/composites and its widget overrides. The
 *     SvelteKit folder on disk is never touched.
 *   - `duplicate` `{ id }` – copy with all pages and composites (made active).
 *   - `open` `{ id }` – makes the project the active one (cookie `active_project`).
 *
 * ## Security
 * The access table (`auth/roles.ts`) requires `guest` for reads and `user` for writes. Every request
 * addressing a project id re-checks ownership through `getAccessibleProject` (owner or admin); a
 * foreign or unknown id answers `404`, so ids can not be probed. Mutations are audit-logged.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setActiveProjectCookie } from '../../../lib/server/active-project.js';
import { recordAudit, type AuditAction } from '../../../lib/server/auth/audit.js';
import { requireUser } from '../../../lib/server/auth/guard.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	createProject,
	deleteProject,
	duplicateProject,
	getAccessibleProject,
	listProjects,
	ProjectStoreError,
	updateProject
} from '../../../lib/server/project-store.js';
import { removeProjectWidgets } from '../../../lib/server/widget-files.js';
import type { ProjectInput } from '../../../lib/projects.js';

const errorStatus = {
	invalid_input: 400,
	name_taken: 409,
	not_found: 404,
	limit: 409,
	conflict: 409,
	in_use: 409
} as const;

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	const projects = await listProjects(await getDatabase(), user);
	return json({ projects, activeId: locals.project?.id ?? null });
};

export const POST: RequestHandler = async ({ request, locals, cookies, url }) => {
	const user = requireUser(locals);
	let body: Record<string, unknown>;
	try {
		const parsed: unknown = await request.json();
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return json({ error: 'Invalid request.' }, { status: 400 });
		}
		body = parsed as Record<string, unknown>;
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}

	const secure = url.protocol === 'https:';
	const actor = { id: user.id, label: user.email ?? user.name };
	const audit = async (action: AuditAction, target: string, detail?: string) =>
		recordAudit(await getDatabase(), { actor, action, target, detail });

	try {
		const db = await getDatabase();

		if (body.action === 'create') {
			const input: ProjectInput = {
				name: body.name as string,
				description: typeof body.description === 'string' ? body.description : undefined,
				path: typeof body.path === 'string' ? body.path : undefined
			};
			const project = await createProject(db, user.id, input);
			if (body.activate !== false) setActiveProjectCookie(cookies, project.id, secure);
			await audit('project_create', project.name);
			return json({ project });
		}

		// Everything below addresses an existing project: ownership first, then the action.
		const existing = await getAccessibleProject(db, user, body.id);
		if (!existing) return json({ error: 'Project not found.' }, { status: 404 });
		const owner = existing.ownerId === user.id ? '' : `owner ${existing.ownerName}`;

		if (body.action === 'open') {
			setActiveProjectCookie(cookies, existing.id, secure);
			return json({ project: existing });
		}
		if (body.action === 'update') {
			const patch: Partial<ProjectInput> = {};
			if ('name' in body) patch.name = body.name as string;
			if ('description' in body) patch.description = body.description as string;
			if ('path' in body) patch.path = body.path as string;
			if ('theme' in body) patch.theme = body.theme as ProjectInput['theme'];
			const project = await updateProject(db, existing.id, patch);
			await audit('project_update', project.name, owner || undefined);
			return json({ project });
		}
		if (body.action === 'duplicate') {
			const project = await duplicateProject(db, existing.id);
			setActiveProjectCookie(cookies, project.id, secure);
			await audit('project_create', project.name, `copy of ${existing.name}`);
			return json({ project });
		}
		if (body.action === 'delete') {
			await deleteProject(db, existing.id);
			await removeProjectWidgets(existing.id).catch(() => undefined);
			await audit('project_delete', existing.name, owner || undefined);
			return json({ deleted: existing.id });
		}
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectStoreError) {
			return json({ error: error.message }, { status: errorStatus[error.code] });
		}
		console.error('Project request failed.', error);
		return json({ error: 'The project request failed.' }, { status: 500 });
	}
};
