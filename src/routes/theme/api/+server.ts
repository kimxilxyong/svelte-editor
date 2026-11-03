/**
 * @fileoverview JSON API for managing the named themes library (`/theme/api`).
 *
 * - `GET /theme/api` → `{ themes }` – all available {@link ManagedTheme} entries.
 * - `POST /theme/api` (requires `poweruser`):
 *   - `{ action: 'create', name, theme, applyToProject? }` – creates a new named theme and
 *     optionally applies it to the active project.
 *   - `{ action: 'save', id, name?, theme?, applyToProject? }` – updates an existing named theme
 *     and optionally applies it to the active project.
 *   - `{ action: 'delete', id }` – deletes a named theme (at least one theme must remain).
 *   - `{ action: 'apply', theme }` – applies `theme` to the active project.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole, requireUser } from '../../../lib/server/auth/guard.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	createManagedTheme,
	deleteManagedTheme,
	listThemes,
	ProjectStoreError,
	updateManagedTheme,
	updateProject
} from '../../../lib/server/project-store.js';
import type { SiteTheme } from '../../../lib/theme.js';

const errorStatus = {
	invalid_input: 400,
	name_taken: 409,
	not_found: 404,
	limit: 409,
	conflict: 409
} as const;

export const GET: RequestHandler = async ({ locals }) => {
	requireUser(locals);
	const themes = await listThemes(await getDatabase());
	return json({ themes });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireRole(locals, 'poweruser');
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

	const db = await getDatabase();
	try {
		if (body.action === 'create') {
			const created = await createManagedTheme(db, {
				name: body.name,
				theme: body.theme
			});
			if (body.applyToProject && locals.project) {
				await updateProject(db, locals.project.id, { theme: created.theme });
			}
			return json({ theme: created, themes: await listThemes(db) });
		}

		if (body.action === 'save') {
			if (typeof body.id !== 'string' || !body.id) {
				return json({ error: 'Theme id is required.' }, { status: 400 });
			}
			const updated = await updateManagedTheme(db, body.id, {
				name: body.name,
				theme: body.theme
			});
			if (body.applyToProject && locals.project) {
				await updateProject(db, locals.project.id, { theme: updated.theme });
			}
			return json({ theme: updated, themes: await listThemes(db) });
		}

		if (body.action === 'delete') {
			if (typeof body.id !== 'string' || !body.id) {
				return json({ error: 'Theme id is required.' }, { status: 400 });
			}
			await deleteManagedTheme(db, body.id);
			return json({ deleted: body.id, themes: await listThemes(db) });
		}

		if (body.action === 'apply') {
			if (!locals.project) {
				return json({ error: 'Create or open a project first.' }, { status: 409 });
			}
			await updateProject(db, locals.project.id, { theme: body.theme as SiteTheme });
			return json({ applied: true, themes: await listThemes(db) });
		}

		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectStoreError) {
			return json({ error: error.message }, { status: errorStatus[error.code] });
		}
		console.error('Theme API request failed.', error);
		return json({ error: 'The theme request failed.' }, { status: 500 });
	}
};
