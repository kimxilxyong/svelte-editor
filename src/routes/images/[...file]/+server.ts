/**
 * @fileoverview Serves image files stored in `static/images/` (including files uploaded at runtime).
 *
 * Static assets that exist when the server starts are served directly by Vite/SvelteKit; this route
 * ensures newly created or imported image files under `/images/<category>/<file>` are immediately
 * reachable without a server restart.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLocalImageFile } from '../../../lib/server/image-files.js';

export const GET: RequestHandler = async ({ params }) => {
	const file = params.file ?? '';
	const resolved = await readLocalImageFile(`/images/${file}`);
	if (!resolved) throw error(404, 'Image not found.');
	return new Response(new Uint8Array(resolved.bytes), {
		headers: {
			'content-type': resolved.contentType,
			'cache-control': 'public, max-age=3600'
		}
	});
};
