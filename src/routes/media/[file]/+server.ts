/**
 * @fileoverview Serves a managed image only from the caller's authorized active project.
 *
 * The exported SvelteKit project uses the same URL under its static/media directory. Responses
 * are private and non-cacheable because the same URL may exist in a duplicated project.
 */

import type { RequestHandler } from './$types';
import { getDatabase } from '../../../lib/server/database/manager.js';
import { getProjectImageRecord } from '../../../lib/server/project-store.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	const match = /^([a-zA-Z0-9_-]+)\.(png|jpg|gif|webp|svg)$/.exec(params.file);
	if (!locals.project || !match) return new Response('Not found', { status: 404 });
	try {
		const image = await getProjectImageRecord(await getDatabase(), locals.project.id, match[1]);
		if (
			!image ||
			image.kind !== 'managed' ||
			image.url !== `/media/${params.file}` ||
			!image.data ||
			!image.mimeType
		) {
			return new Response('Not found', { status: 404 });
		}
		return new Response(Uint8Array.from(Buffer.from(image.data, 'base64')), {
			headers: {
				'Content-Type': image.mimeType,
				'Cache-Control': 'private, no-store',
				'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (error) {
		console.error('Unable to load managed image.', error);
		return new Response('Unable to load image', { status: 500 });
	}
};
