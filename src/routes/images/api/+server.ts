/**
 * @fileoverview JSON & multipart API for managing the image catalog (`/images/api`).
 *
 * - `GET /images/api` → `{ images }` – all available {@link ManagedImage} entries.
 * - `POST /images/api`:
 *   - JSON `{ action: 'create', name, url?, content?, category, downloadRemote? }`:
 *     creates a new image entry. When `content` (inline `<svg>` or `data:image/...`) is supplied,
 *     writes the file to `static/images/<category>/` first. When `downloadRemote` is `true` for an
 *     `http(s)://` URL, fetches the remote asset and stores it locally under `static/images/<category>/`.
 *   - JSON `{ action: 'update', id, name?, url?, category? }`: updates an existing image's metadata.
 *   - JSON `{ action: 'delete', id }`: deletes an image from the catalog and removes its file from
 *     `static/images/` if it was user-uploaded.
 *   - JSON `{ action: 'restore' }`: restores any deleted prepopulated SVG Repo icons.
 *   - `multipart/form-data` (`action = 'import'`): uploads one or more image files (`files`),
 *     writes them to `static/images/<category>/` and registers them in the `images` table.
 */

import { json } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestHandler } from './$types';
import {
	isValidImageCategory,
	normalizeImageName,
	type ImageCategory,
	type ManagedImage
} from '../../../lib/images.js';
import { requireRole, requireUser } from '../../../lib/server/auth/guard.js';
import { getDatabase } from '../../../lib/server/database/manager.js';
import {
	ImageFileError,
	removeStoredImageFile,
	storeImageFile,
	storeInlineImage
} from '../../../lib/server/image-files.js';
import { crawlWebPageForSvgs, importCrawledSvgs } from '../../../lib/server/svg-crawler.js';
import {
	createManagedImage,
	deleteManagedImage,
	listImages,
	ProjectStoreError,
	restorePrepopulatedImages,
	updateManagedImage
} from '../../../lib/server/project-store.js';

const errorStatus = { invalid_input: 400, name_taken: 409, not_found: 404, limit: 409 } as const;

/** Builds a human-readable display name from a filename when none is explicitly provided. */
function humanizeFilename(filename: string): string {
	const stem = path.basename(filename, path.extname(filename));
	const cleaned = stem
		.replace(/-svgrepo-com$/i, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return 'Imported Image';
	return cleaned.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()).slice(0, 70);
}

/** Picks a unique image name by appending ` 2`, ` 3`, ... when `base` is already taken. */
function uniqueImageName(base: string, existingNames: Set<string>): string {
	const clean = normalizeImageName(base) ?? 'Imported Image';
	let candidate = clean;
	let suffix = 2;
	while (existingNames.has(candidate.toLowerCase())) {
		candidate = `${clean.slice(0, 72)} ${suffix++}`;
	}
	existingNames.add(candidate.toLowerCase());
	return candidate;
}

export const GET: RequestHandler = async ({ locals }) => {
	requireUser(locals);
	const images = await listImages(await getDatabase());
	return json({ images });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireRole(locals, 'user');
	const db = await getDatabase();
	const contentType = request.headers.get('content-type') ?? '';

	try {
		if (contentType.includes('multipart/form-data')) {
			const form = await request.formData();
			const rawCategory = String(form.get('category') ?? 'custom');
			const category: ImageCategory = isValidImageCategory(rawCategory) ? rawCategory : 'custom';
			const customName = normalizeImageName(form.get('name'));
			const entries = [
				...form.getAll('files'),
				...(form.has('file') ? [form.get('file')!] : [])
			].filter((item): item is File => item instanceof File && item.size > 0);

			if (entries.length === 0) {
				return json({ error: 'Select at least one image file to import.' }, { status: 400 });
			}

			const current = await listImages(db);
			const takenNames = new Set(current.map((img) => img.name.toLowerCase()));
			const imported: ManagedImage[] = [];

			for (const [index, file] of entries.entries()) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const url = await storeImageFile({
					filename: file.name,
					category,
					bytes
				});
				const desiredName =
					entries.length === 1 && customName
						? customName
						: humanizeFilename(file.name || `Image ${index + 1}`);
				const name = uniqueImageName(desiredName, takenNames);
				const created = await createManagedImage(db, { name, url, category });
				imported.push(created);
			}

			return json({ imported, images: await listImages(db) });
		}

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

		if (body.action === 'create') {
			const rawCategory = body.category ?? 'custom';
			const category: ImageCategory = isValidImageCategory(rawCategory) ? rawCategory : 'custom';
			const name = normalizeImageName(body.name);
			if (!name) {
				return json({ error: 'Enter an image name.' }, { status: 400 });
			}

			let url = typeof body.url === 'string' ? body.url.trim() : '';
			if (typeof body.content === 'string' && body.content.trim().length > 0) {
				url = await storeInlineImage({
					name,
					category,
					content: body.content
				});
			} else if (body.downloadRemote === true && /^https?:\/\//i.test(url)) {
				let response: Response;
				try {
					response = await fetch(url);
				} catch {
					return json({ error: 'Could not download the remote image.' }, { status: 400 });
				}
				if (!response.ok) {
					return json(
						{ error: `Remote server returned ${response.status} when fetching the image.` },
						{ status: 400 }
					);
				}
				const bytes = new Uint8Array(await response.arrayBuffer());
				const urlPathname = new URL(url).pathname;
				const ext = path.extname(urlPathname).toLowerCase() || '.svg';
				url = await storeImageFile({
					filename: `${name}${ext}`,
					category,
					bytes
				});
			}

			const image = await createManagedImage(db, { name, url, category });
			return json({ image, images: await listImages(db) });
		}

		if (body.action === 'update') {
			if (typeof body.id !== 'string' || !body.id) {
				return json({ error: 'Image id is required.' }, { status: 400 });
			}
			const patch: { name?: unknown; url?: unknown; category?: unknown } = {};
			if ('name' in body) patch.name = body.name;
			if ('url' in body) patch.url = body.url;
			if ('category' in body) patch.category = body.category;
			const image = await updateManagedImage(db, body.id, patch);
			return json({ image, images: await listImages(db) });
		}

		if (body.action === 'delete') {
			if (typeof body.id !== 'string' || !body.id) {
				return json({ error: 'Image id is required.' }, { status: 400 });
			}
			const removed = await deleteManagedImage(db, body.id);
			if (!removed.builtIn) {
				await removeStoredImageFile(removed.url);
			}
			return json({ deleted: removed.id, images: await listImages(db) });
		}

		if (body.action === 'restore') {
			const images = await restorePrepopulatedImages(db);
			return json({ images });
		}

		if (body.action === 'crawl-preview') {
			const preview = await crawlWebPageForSvgs(body.url);
			return json(preview);
		}

		if (body.action === 'crawl-import') {
			const rawCategory = body.category ?? 'custom';
			const category: ImageCategory = isValidImageCategory(rawCategory) ? rawCategory : 'custom';
			const folder =
				typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : 'crawled';
			const rawItems = Array.isArray(body.items) ? body.items : [];
			const items = rawItems
				.filter(
					(item): item is Record<string, unknown> => typeof item === 'object' && item !== null
				)
				.map((item) => ({
					name: typeof item.name === 'string' ? item.name : 'SVG Icon',
					sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : undefined,
					inlineSvg: typeof item.inlineSvg === 'string' ? item.inlineSvg : undefined
				}));
			const imported = await importCrawledSvgs(db, { folder, category, items });
			return json({ imported, images: await listImages(db) });
		}

		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectStoreError) {
			return json({ error: error.message }, { status: errorStatus[error.code] });
		}
		if (error instanceof ImageFileError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('Image API request failed.', error);
		return json({ error: 'The image request failed.' }, { status: 500 });
	}
};
