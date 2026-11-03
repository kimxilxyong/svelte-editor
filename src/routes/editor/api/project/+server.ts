/**
 * @fileoverview SvelteKit project integration API of the **active project** (power users and above).
 *
 * `POST /editor/api/project`
 *
 * - `action: 'export'`: writes the site and active project's image library into the SvelteKit folder.
 * - `action: 'create'`: scaffolds a brand-new SvelteKit app in an empty folder, then exports the site.
 * - `action: 'import'`: reads pages/composites from the folder, merges them into the saved site
 *   (see `site-merge.ts`) with its validated image library and saves the result atomically.
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
import {
	loadProjectExportSnapshot,
	mergeImportedProject,
	ProjectStoreError,
	updateProject
} from '../../../../lib/server/project-store.js';
import { ImageImportError, validateImageFile } from '../../../../lib/server/image-import.js';
import type { ImageExportRecord } from '../../../../lib/image-types.js';

/** Revalidates untrusted imported file bytes, including sanitizing SVG again before storage. */
async function validateImportedImages(records: ImageExportRecord[]): Promise<ImageExportRecord[]> {
	const result: ImageExportRecord[] = [];
	for (const image of records) {
		if (image.kind !== 'managed') {
			result.push(image);
			continue;
		}
		if (
			!image.data ||
			image.data.length > 14 * 1024 * 1024 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)
		) {
			throw new ProjectError(`The imported image "${image.name}" has invalid contents.`);
		}
		const validated = await validateImageFile(Buffer.from(image.data, 'base64'));
		if (
			image.url !== `/media/${image.id}.${validated.extension}` ||
			image.mimeType !== validated.mimeType
		) {
			throw new ProjectError(`The imported image "${image.name}" has an invalid URL or type.`);
		}
		result.push({
			...image,
			size: validated.data.byteLength,
			data: validated.data.toString('base64')
		});
	}
	return result;
}

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
	if (!('expectedProjectId' in body) || body.expectedProjectId !== project.id) {
		return json(
			{ error: 'The active project changed. Reload before continuing.' },
			{ status: 409 }
		);
	}

	const {
		action,
		root: rootInput,
		site: siteInput,
		componentName,
		componentPath,
		install,
		revision
	} = body as Record<string, unknown>;
	const root = typeof rootInput === 'string' && rootInput.trim() ? rootInput.trim() : project.path;

	try {
		const db = await getDatabase();
		/** Remembers a folder that worked, so the next action does not ask for it again. */
		const rememberRoot = async (used: string) => {
			if (used !== project.path) await updateProject(db, project.id, { path: used });
		};

		if (action === 'export' || action === 'create') {
			const snapshot = await loadProjectExportSnapshot(db, project.id);
			const site = siteInput === undefined ? snapshot.site : parseEditorSite(siteInput);
			if (!site) {
				return json(
					{ error: 'The site contains invalid pages, links or components.' },
					{ status: 400 }
				);
			}
			if (siteInput !== undefined && revision !== snapshot.revision) {
				return json(
					{ error: 'The project changed. Reload before exporting a draft.' },
					{ status: 409 }
				);
			}
			const images = snapshot.images;
			if (action === 'create') {
				const result = await createProject(root, site, project.theme, {
					install: install === true,
					widgetProjectId: project.id,
					images
				});
				await rememberRoot(result.root);
				return json(result);
			}
			const result = await exportSite(root, site, project.theme, {
				widgetProjectId: project.id,
				images
			});
			await rememberRoot(root);
			return json(result);
		}
		if (action === 'import') {
			const imported = await importSite(root);
			const images =
				imported.images === undefined ? undefined : await validateImportedImages(imported.images);
			const merged = await mergeImportedProject(db, project.id, { ...imported, images });
			const site = merged.site;
			const { dropped } = merged;
			await rememberRoot(root);
			return json({
				pages: imported.pages,
				composites: imported.composites,
				components: imported.components,
				skipped: imported.skipped,
				imageCount: images?.length ?? 0,
				dropped,
				pageCount: site.pages.length
			});
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
		if (error instanceof ImageImportError) return json({ error: error.message }, { status: 400 });
		if (error instanceof ProjectStoreError) {
			return json({ error: error.message }, { status: error.code === 'conflict' ? 409 : 400 });
		}
		console.error('Project export/import failed.', error);
		return json({ error: 'The project files could not be read or written.' }, { status: 500 });
	}
};
