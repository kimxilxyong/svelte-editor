/**
 * @fileoverview Image-library API for the authorized active project.
 *
 * GET lists metadata; JSON POST creates, edits, deletes or imports an image by remote URL.
 * Multipart POST uploads a file. File contents are bounded and validated before persistence,
 * and the project is taken only from `locals.project`, never from request data.
 */

import { randomBytes } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	downloadImage,
	ImageImportError,
	validateImageFile
} from '../../../lib/server/image-import.js';
import {
	createProjectImage,
	deleteProjectImage,
	listProjectImages,
	ProjectStoreError,
	updateProjectImage
} from '../../../lib/server/project-store.js';
import type { ImageCategory } from '../../../lib/image-types.js';

const maxBody = 10 * 1024 * 1024 + 128 * 1024;
const maxJsonBody = 16 * 1024;

/** Reads the request with an actual streaming limit, including requests without Content-Length. */
async function boundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
	const length = request.headers.get('content-length');
	if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
		throw new ImageImportError('The request is too large.');
	}
	if (!request.body) throw new ImageImportError('The request body is missing.');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new ImageImportError('The request is too large.');
		}
		chunks.push(value);
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

/** Generates a short, unpredictable URL-safe identifier that also survives project export. */
function imageId(): string {
	return randomBytes(16).toString('base64url');
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.project) return json({ project: null, images: [] });
	try {
		const images = await listProjectImages(await getDatabase(), locals.project.id);
		return json({ project: { id: locals.project.id, name: locals.project.name }, images });
	} catch (error) {
		console.error('Unable to load project images.', error);
		return json({ error: 'Unable to load project images.' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.project) return json({ error: 'Create or open a project first.' }, { status: 409 });
	const projectId = locals.project.id;
	try {
		const contentType = request.headers.get('content-type') ?? '';
		const db = await getDatabase();
		if (contentType.toLowerCase().startsWith('multipart/form-data;')) {
			const body = await boundedBody(request, maxBody);
			const form = await new Response(body, {
				headers: { 'content-type': contentType }
			}).formData();
			if (form.get('expectedProjectId') !== projectId) {
				return json(
					{ error: 'The active project changed. Reload the image library.' },
					{ status: 409 }
				);
			}
			const file = form.get('file');
			if (form.get('action') !== 'upload' || !file || typeof file === 'string') {
				throw new ImageImportError('Choose an image file to upload.');
			}
			const validated = await validateImageFile(new Uint8Array(await file.arrayBuffer()));
			const id = imageId();
			const image = await createProjectImage(db, projectId, {
				id,
				name: String(form.get('name') ?? ''),
				category: String(form.get('category') ?? '') as ImageCategory,
				url: `/media/${id}.${validated.extension}`,
				kind: 'managed',
				mimeType: validated.mimeType,
				size: validated.data.byteLength,
				data: validated.data.toString('base64')
			});
			return json({ image }, { status: 201 });
		}
		if (!contentType.toLowerCase().startsWith('application/json')) {
			return json({ error: 'Send JSON or an image upload.' }, { status: 415 });
		}
		let input: unknown;
		try {
			input = JSON.parse(new TextDecoder().decode(await boundedBody(request, maxJsonBody)));
		} catch (error) {
			if (error instanceof ImageImportError) throw error;
			return json({ error: 'The request body must be valid JSON.' }, { status: 400 });
		}
		if (typeof input !== 'object' || input === null || Array.isArray(input)) {
			return json({ error: 'Invalid request.' }, { status: 400 });
		}
		const body = input as Record<string, unknown>;
		if (body.expectedProjectId !== projectId) {
			return json(
				{ error: 'The active project changed. Reload the image library.' },
				{ status: 409 }
			);
		}
		if (body.action === 'create') {
			const image = await createProjectImage(db, projectId, {
				id: imageId(),
				name: typeof body.name === 'string' ? body.name : '',
				category: (typeof body.category === 'string' ? body.category : '') as ImageCategory,
				url: typeof body.url === 'string' ? body.url : '',
				kind: 'link'
			});
			return json({ image }, { status: 201 });
		}
		if (body.action === 'import') {
			if (typeof body.url !== 'string') throw new ImageImportError('Enter an image URL.');
			const validated = await downloadImage(body.url);
			const id = imageId();
			const image = await createProjectImage(db, projectId, {
				id,
				name: typeof body.name === 'string' ? body.name : '',
				category: (typeof body.category === 'string' ? body.category : '') as ImageCategory,
				url: `/media/${id}.${validated.extension}`,
				kind: 'managed',
				mimeType: validated.mimeType,
				size: validated.data.byteLength,
				data: validated.data.toString('base64')
			});
			return json({ image }, { status: 201 });
		}
		if (body.action === 'update' && typeof body.id === 'string') {
			const image = await updateProjectImage(db, projectId, body.id, {
				name: body.name,
				category: body.category,
				url: body.url
			});
			return json({ image });
		}
		if (body.action === 'delete' && typeof body.id === 'string') {
			await deleteProjectImage(db, projectId, body.id);
			return json({ success: true });
		}
		return json({ error: 'Unknown image action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ImageImportError) return json({ error: error.message }, { status: 400 });
		if (error instanceof ProjectStoreError) {
			const status =
				error.code === 'not_found' ? 404 : ['conflict', 'in_use'].includes(error.code) ? 409 : 400;
			return json({ error: error.message }, { status });
		}
		console.error('Image request failed.', error);
		return json({ error: 'The image request failed.' }, { status: 500 });
	}
};
