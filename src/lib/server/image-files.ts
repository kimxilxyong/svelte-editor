/**
 * @fileoverview Server-side file storage for managed images (`static/images/`).
 *
 * Prepopulated Isometric 3D icons from SVG Repo live in `static/images/isometric/*.svg`.
 * User-created or imported image files are written to `static/images/<category>/<slug>.<ext>`
 * (overridable via `IMAGES_DIR` in tests) so SvelteKit serves them at `/images/<category>/<slug>.<ext>`
 * and the project exporter (`server/project.ts`) can copy referenced local images into exported
 * SvelteKit projects.
 *
 * Security:
 * - Path traversal is prevented by strict category validation, slug sanitization and `path.resolve`
 *   prefix checks.
 * - Uploaded SVG content is checked for `<svg` and rejected if it contains `<script>` tags or
 *   inline `on*=` event attributes.
 * - File size is capped at {@link imageLimits.maxFileBytes}.
 */

import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imageLimits, isValidImageCategory, type ImageCategory } from '../images.js';

/** Allowed file extensions and their corresponding MIME types. */
const allowedExtensions = new Map<string, string>([
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.webp', 'image/webp'],
	['.gif', 'image/gif']
]);

/** Error safe to display to the user when an image file operation fails. */
export class ImageFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageFileError';
	}
}

/**
 * Root directory on disk where `/images/...` files are stored (`<cwd>/static/images` by default, or
 * `process.env.IMAGES_DIR` during tests).
 */
export function imagesDirectory(): string {
	return path.resolve(process.cwd(), process.env.IMAGES_DIR || 'static/images');
}

/**
 * Converts a display name or filename into a clean kebab-case file stem.
 *
 * @param raw - Name or filename stem.
 * @returns Non-empty kebab-case stem.
 */
export function slugifyImageFile(raw: string): string {
	return (
		raw
			.toLowerCase()
			.replace(/\.[a-z0-9]+$/i, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'image'
	);
}

/**
 * Validates and sanitizes SVG source text against embedded scripts and event handlers.
 *
 * @param svg - Raw SVG markup.
 * @returns Trimmed SVG string.
 * @throws {ImageFileError} When the text is not a safe SVG document.
 */
export function validateSvgContent(svg: string): string {
	const trimmed = svg.trim();
	if (!/<svg[\s>]/i.test(trimmed) || !/<\/svg\s*>/i.test(trimmed)) {
		throw new ImageFileError('The file does not contain a valid <svg> element.');
	}
	if (
		/<script[\s>]/i.test(trimmed) ||
		/\bon[a-z]+\s*=/i.test(trimmed) ||
		/javascript:/i.test(trimmed)
	) {
		throw new ImageFileError('SVG files may not contain scripts or inline event handlers.');
	}
	return trimmed;
}

/**
 * Picks a free file path inside `static/images/<folder>/` so existing files are never overwritten.
 */
async function uniqueImageFilePath(
	folder: string,
	baseSlug: string,
	ext: string
): Promise<{ fullPath: string; url: string }> {
	const safeFolder = slugifyImageFile(folder);
	const baseDir = imagesDirectory();
	const targetDir = path.join(baseDir, safeFolder);
	const relCheck = path.relative(baseDir, targetDir);
	if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
		throw new ImageFileError('Invalid target image folder.');
	}
	await mkdir(targetDir, { recursive: true });

	let candidate = `${baseSlug}${ext}`;
	let counter = 2;
	while (
		await lstat(path.join(targetDir, candidate)).then(
			() => true,
			() => false
		)
	) {
		candidate = `${baseSlug}-${counter++}${ext}`;
	}
	return {
		fullPath: path.join(targetDir, candidate),
		url: `/images/${safeFolder}/${candidate}`
	};
}

/**
 * Saves an uploaded binary or SVG image into `static/images/<folder>/` (where `folder` defaults to
 * `category`) and returns its public URL.
 *
 * @param options - File name, category, optional custom subfolder and binary/text bytes.
 * @returns The public URL path (`/images/<folder>/<file>`).
 * @throws {ImageFileError} On unsupported format, oversized payload or unsafe SVG content.
 */
export async function storeImageFile(options: {
	filename: string;
	category: ImageCategory;
	folder?: string;
	bytes: Uint8Array;
}): Promise<string> {
	if (!isValidImageCategory(options.category)) {
		throw new ImageFileError('Choose a valid image category.');
	}
	if (options.bytes.byteLength === 0) {
		throw new ImageFileError('The image file is empty.');
	}
	if (options.bytes.byteLength > imageLimits.maxFileBytes) {
		throw new ImageFileError('The image file exceeds the 2 MB size limit.');
	}

	const rawExt = path.extname(options.filename).toLowerCase() || '.svg';
	if (!allowedExtensions.has(rawExt)) {
		throw new ImageFileError('Unsupported image format. Use SVG, PNG, JPG, WebP or GIF.');
	}

	let dataToWrite: Uint8Array | string = options.bytes;
	if (rawExt === '.svg') {
		const text = new TextDecoder('utf-8').decode(options.bytes);
		dataToWrite = validateSvgContent(text);
	}

	const folder = options.folder ? slugifyImageFile(options.folder) : options.category;
	const stem = slugifyImageFile(path.basename(options.filename, rawExt));
	const { fullPath, url } = await uniqueImageFilePath(folder, stem, rawExt);
	await writeFile(fullPath, dataToWrite);
	return url;
}

/**
 * Saves inline SVG markup or a `data:image/...` URI as a file in `static/images/<folder>/`.
 *
 * @param options - Display name, category, optional folder and raw SVG or data URI.
 * @returns Public URL path (`/images/<folder>/<file>`).
 */
export async function storeInlineImage(options: {
	name: string;
	category: ImageCategory;
	folder?: string;
	content: string;
}): Promise<string> {
	const trimmed = options.content.trim();
	if (trimmed.startsWith('<')) {
		const clean = validateSvgContent(trimmed);
		return storeImageFile({
			filename: `${slugifyImageFile(options.name)}.svg`,
			category: options.category,
			folder: options.folder,
			bytes: new TextEncoder().encode(clean)
		});
	}
	const dataMatch = /^data:image\/([a-z0-9+.-]+);base64,([a-z0-9+/=\s]+)$/i.exec(trimmed);
	if (dataMatch) {
		const mimeSubtype = dataMatch[1].toLowerCase();
		const ext =
			mimeSubtype === 'svg+xml' ? '.svg' : mimeSubtype === 'jpeg' ? '.jpg' : `.${mimeSubtype}`;
		const bytes = new Uint8Array(Buffer.from(dataMatch[2], 'base64'));
		return storeImageFile({
			filename: `${slugifyImageFile(options.name)}${ext}`,
			category: options.category,
			folder: options.folder,
			bytes
		});
	}
	throw new ImageFileError('Provide valid <svg> markup or a base64 data:image URI.');
}

/**
 * Deletes a user-stored image file from `static/images/` if it resides outside the built-in
 * `isometric` seed folder. Missing files are ignored.
 *
 * @param url - Stored image URL (e.g. `/images/custom/icon.svg`).
 */
export async function removeStoredImageFile(url: string): Promise<void> {
	if (!url.startsWith('/images/') || url.startsWith('/images/isometric/')) return;
	const relative = url.slice('/images/'.length);
	if (!relative || relative.includes('..') || relative.includes('\0')) return;
	const baseDir = imagesDirectory();
	const target = path.resolve(baseDir, relative);
	const relCheck = path.relative(baseDir, target);
	if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return;
	await rm(target, { force: true }).catch(() => undefined);
}

/**
 * Resolves a local image URL (`/images/...` or `/*.svg`) to its on-disk file buffer and MIME type.
 *
 * @param urlPath - Root-relative URL path such as `/images/custom/logo.svg`.
 * @returns `{ bytes, contentType }` or `null` if the file does not exist or is not an allowed image.
 */
export async function readLocalImageFile(
	urlPath: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
	if (!urlPath.startsWith('/') || urlPath.startsWith('//') || urlPath.includes('\0')) return null;
	const ext = path.extname(urlPath).toLowerCase();
	const contentType = allowedExtensions.get(ext);
	if (!contentType) return null;

	let fullPath: string;
	if (urlPath.startsWith('/images/')) {
		const baseDir = imagesDirectory();
		const rel = urlPath.slice('/images/'.length);
		fullPath = path.resolve(baseDir, rel);
		const check = path.relative(baseDir, fullPath);
		if (check.startsWith('..') || path.isAbsolute(check)) return null;
	} else {
		const staticDir = path.resolve(process.cwd(), 'static');
		fullPath = path.resolve(staticDir, urlPath.slice(1));
		const check = path.relative(staticDir, fullPath);
		if (check.startsWith('..') || path.isAbsolute(check)) return null;
	}

	try {
		const bytes = await readFile(fullPath);
		return { bytes, contentType };
	} catch {
		return null;
	}
}
