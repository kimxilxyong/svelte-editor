import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEditorSite } from '../../../../lib/editor.js';
import { exportSite, importSite, ProjectError } from '../../../../lib/server/project.js';

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
	const { action, root, site: siteInput } = body as Record<string, unknown>;

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
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectError) return json({ error: error.message }, { status: 400 });
		console.error('Project export/import failed.', error);
		return json({ error: 'The project files could not be read or written.' }, { status: 500 });
	}
};
