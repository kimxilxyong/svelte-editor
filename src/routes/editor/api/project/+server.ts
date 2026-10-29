/**
 * @fileoverview SvelteKit Project Integration API Endpoint.
 *
 * `POST /editor/api/project`
 *
 * Routes project-level operations between the client UI and the server filesystem:
 * - `action: 'export'`: Exports an entire EditorSite to a real SvelteKit application directory.
 * - `action: 'import'`: Scans and imports all components and pages from a SvelteKit application directory.
 * - `action: 'export-component'`: Exports a single component by name into `src/lib/components/editor/`.
 * - `action: 'import-component'`: Imports and parses a single `.svelte` component file.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../../lib/editor.js';
import {
	exportSite,
	importSite,
	exportSingleComponent,
	importSingleComponent,
	ProjectError
} from '../../../../lib/server/project.js';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return json({ error: 'Invalid request.' }, { status: 400 });
	}
	const {
		action,
		root,
		site: siteInput,
		componentName,
		componentPath
	} = body as Record<string, unknown>;

	try {
		if (action === 'export') {
			const site = parseEditorSite(siteInput);
			if (!site) {
				return json(
					{ error: 'The site contains invalid pages, links or components.' },
					{ status: 400 }
				);
			}
			return json(await exportSite(root, site));
		}
		if (action === 'import') return json(await importSite(root));
		if (action === 'export-component') {
			if (typeof componentName !== 'string' || !componentName.trim()) {
				return json({ error: 'componentName is required.' }, { status: 400 });
			}
			return json(await exportSingleComponent(root, componentName.trim()));
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
