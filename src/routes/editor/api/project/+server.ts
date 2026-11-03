/**
 * @fileoverview SvelteKit project integration API of the **active project** (power users and above).
 *
 * `POST /editor/api/project`
 *
 * - `action: 'export'`: writes the saved site (or the `site` sent along) into the SvelteKit folder.
 * - `action: 'create'`: scaffolds a brand-new SvelteKit app in an empty folder, then exports the site.
 * - `action: 'import'`: reads pages/composites from the folder, merges them into the saved site
 *   (see `site-merge.ts`) and saves the result.
 * - `action: 'export-component'` / `'import-component'`: one component by name / path.
 *
 * The folder is `root` from the request when given, otherwise the project's own `path`; a folder that
 * was used successfully is stored as the project's `path`. Site, theme and widget overrides always
 * come from `locals.project` – never from the request – so a user can only export their own work.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../../lib/editor.js';
import { getDatabase } from '../../../../lib/server/database/manager.js';
import {
	exportSite,
	importSite,
	exportSingleComponent,
	importSingleComponent,
	ProjectError
} from '../../../../lib/server/project.js';
import { createProject } from '../../../../lib/server/new-project.js';
import { loadSite, saveSite, updateProject } from '../../../../lib/server/project-store.js';
import { mergeImportedSite } from '../../../../lib/site-merge.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}
	const project = locals.project;
	if (!project) return json({ error: 'Create or open a project first.' }, { status: 409 });

	const {
		action,
		root: rootInput,
		site: siteInput,
		componentName,
		componentPath,
		install
	} = body as Record<string, unknown>;
	const root = typeof rootInput === 'string' && rootInput.trim() ? rootInput.trim() : project.path;

	try {
		const db = await getDatabase();
		/** Remembers a folder that worked, so the next action does not ask for it again. */
		const rememberRoot = async (used: string) => {
			if (used !== project.path) await updateProject(db, project.id, { path: used });
		};

		if (action === 'export' || action === 'create') {
			const site =
				siteInput === undefined ? await loadSite(db, project.id) : parseEditorSite(siteInput);
			if (!site) {
				return json(
					{ error: 'The site contains invalid pages, links or components.' },
					{ status: 400 }
				);
			}
			if (action === 'create') {
				const result = await createProject(root, site, project.theme, {
					install: install === true,
					widgetProjectId: project.id
				});
				await rememberRoot(result.root);
				return json(result);
			}
			const result = await exportSite(root, site, project.theme, { widgetProjectId: project.id });
			await rememberRoot(root);
			return json(result);
		}
		if (action === 'import') {
			const imported = await importSite(root);
			const merged = mergeImportedSite(await loadSite(db, project.id), imported);
			const site = parseEditorSite(merged.site);
			if (!site) throw new ProjectError('The imported pages or components are not valid.');
			const { dropped } = merged;
			await saveSite(db, project.id, site);
			await rememberRoot(root);
			return json({ ...imported, dropped, pageCount: site.pages.length });
		}
		if (action === 'export-component') {
			if (typeof componentName !== 'string' || !componentName.trim()) {
				return json({ error: 'componentName is required.' }, { status: 400 });
			}
			return json(await exportSingleComponent(root, componentName.trim(), project.id));
		}
		if (action === 'import-component') {
			if (typeof componentPath !== 'string' || !componentPath.trim()) {
				return json({ error: 'componentPath is required.' }, { status: 400 });
			}
			return json(await importSingleComponent(root, componentPath.trim()));
		}
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectError) return json({ error: error.message }, { status: 400 });
		console.error('Project export/import failed.', error);
		return json({ error: 'The project files could not be read or written.' }, { status: 500 });
	}
};
