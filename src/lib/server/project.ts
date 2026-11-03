/**
 * @fileoverview Server-Side SvelteKit Project Exporter and Importer.
 *
 * Implements bidirectional integration between the visual editor and real,
 * on-disk SvelteKit project directory structures:
 *
 * Key Capabilities:
 * 1. Safe Directory Resolution:
 *    - Resolves real canonical paths using `realpath`.
 *    - Validates that target folders are genuine SvelteKit projects (must contain
 *      `package.json` and `src/routes`).
 * 2. Overwrite Protection:
 *    - Protects user-crafted code: files without the `<!-- @svelte-editor` header
 *      are never overwritten and are instead reported as skipped.
 * 3. Complete Component Export:
 *    - Writes all built-in native widget components (`WidgetSlider.svelte`, etc.) and every
 *      composite component (`Hero.svelte`, …) into `src/lib/components/editor/`.
 *    - Writes route pages into `src/routes/<slug>/+page.svelte`.
 *    - Can emit either legacy `$lib` imports or `#lib` package subpaths, based on the target
 *      project's `package.json` imports map.
 * 4. Two-Way Scanning & Component Import:
 *    - Recursively scans `src/lib/components/` in the target project for any `.svelte` files.
 *    - Parses AST metadata (props, types, defaults) using `svelte-component-parser`.
 *    - Imports pages and binds component references back into the editor's live state.
 * 5. Granular Single-Component Export/Import:
 *    - Allows exporting or importing individual components on demand.
 * 6. Optional image portability:
 *    - Stores bounded, versioned metadata and SHA-256 digests in static/media; managed bytes
 *      are kept at their original /media URLs. Imports reject malformed or incomplete manifests.
 *    - Does not access the database or sanitize image content; callers must revalidate imports.
 */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imageCategories, type ImageExportRecord, type ProjectImage } from '../image-types.js';
import { defaultSiteTheme, normalizeSiteTheme, type SiteTheme } from '../theme.js';
import { effectiveWidgetSource } from './widget-files.js';
import {
	componentNames,
	compositeNamePattern,
	type EditorComposite,
	type EditorPage,
	type EditorSite
} from '../editor.js';
import {
	generatedMarker,
	parseCompositeSource,
	parsePageSource,
	renderCompositeSource,
	renderPageSource,
	type LibImportStyle
} from '../svelte-pages.js';
import { parseSvelteComponent, type ParsedComponentMetadata } from '../svelte-component-parser.js';

/**
 * Raw string templates of all built-in editor components loaded via Vite glob.
 */
const componentSources = import.meta.glob('../components/editor/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Route slug format pattern. */
/** Raw source of the isomorphic theme module, copied verbatim into exported projects. */
const themeSource = (
	import.meta.glob('../theme.ts', { query: '?raw', import: 'default', eager: true }) as Record<
		string,
		string
	>
)['../theme.ts'];

/** Marker for generated TypeScript files (the Svelte marker is an HTML comment). */
const generatedTsMarker = '// @svelte-editor generated';

const slugPattern = /^[a-z0-9-]{1,40}$/;

/**
 * Custom error class for project validation and filesystem operation errors.
 */
export class ProjectError extends Error {}

/**
 * Result report from an export operation.
 */
export type ExportResult = {
	/** Relative file paths successfully written. */
	written: string[];
	/** Files that could not be written or were skipped for safety. */
	skipped: { file: string; reason: string }[];
	/** Non-fatal advice, e.g. that the target project lacks the `flowbite-svelte` dependency. */
	warnings: string[];
};

/** Options controlling how generated source resolves the target project's `src/lib` directory. */
export type ExportSiteOptions = {
	/**
	 * Select `#lib` when the target package.json declares Node subpath imports; otherwise use the
	 * legacy SvelteKit `$lib` alias.
	 */
	libImportStyle?: LibImportStyle;
	/** Project whose widget overrides are exported instead of the built-in defaults. */
	widgetProjectId?: string;
	/** Optional complete image-library snapshot. Managed entries require canonical base64 data. */
	images?: ImageExportRecord[];
};

/**
 * Result report from an import operation.
 */
export type ImportResult = {
	/** Pages successfully reconstructed from project route files. */
	pages: EditorPage[];
	/** Composite components reconstructed from generated files in `src/lib/components/editor/`. */
	composites: EditorComposite[];
	/** Native Svelte components discovered and parsed in src/lib/components/. */
	components: ParsedComponentMetadata[];
	/** Files that failed validation or could not be parsed. */
	skipped: { file: string; reason: string }[];
	/** Image snapshot, present only when a valid manifest exists; caller must sanitize it. */
	images?: ImageExportRecord[];
};

// The manifest is inside the public media directory but contains metadata and digests only.
const imageManifestFile = path.join('static', 'media', '.svelte-editor-images.json');
const maxImageCount = 500;
const maxImageBytes = 10 * 1024 * 1024;
const maxTotalImageBytes = 50 * 1024 * 1024;
const maxImageManifestBytes = 1024 * 1024;
const managedUrlPattern = /^\/media\/([A-Za-z0-9_-]{1,128})\.(png|jpg|gif|webp|svg)$/;
const digestPattern = /^[a-f0-9]{64}$/;

/** On-disk managed entries carry a digest instead of base64 data. */
type ManifestImage = ProjectImage & { sha256?: string };
type ImageManifest = { generator: 'svelte-editor'; version: 1; images: ManifestImage[] };

/** Reject unbounded or ambiguous data before it can become a filesystem path or manifest. */
function validateImage(value: unknown, manifest: boolean): ManifestImage & { data?: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ProjectError('Invalid image entry.');
	const record = value as Record<string, unknown>;
	const fields = new Set([
		'id',
		'name',
		'url',
		'category',
		'kind',
		'mimeType',
		'size',
		manifest ? 'sha256' : 'data'
	]);
	if (Object.keys(record).some((key) => !fields.has(key)))
		throw new ProjectError('Unexpected image entry field.');
	const boundedString = (v: unknown, max: number): v is string =>
		typeof v === 'string' &&
		v.length > 0 &&
		v.length <= max &&
		![...v].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
	if (
		!boundedString(record.id, 128) ||
		!boundedString(record.name, 512) ||
		!boundedString(record.url, 4096) ||
		!imageCategories.some((category) => category === record.category) ||
		(record.kind !== 'link' && record.kind !== 'managed') ||
		(record.mimeType !== undefined && !boundedString(record.mimeType, 128)) ||
		(record.size !== undefined &&
			(!Number.isSafeInteger(record.size) || (record.size as number) < 0))
	)
		throw new ProjectError('Invalid image metadata.');
	if (record.kind === 'managed') {
		const match = managedUrlPattern.exec(record.url);
		if (!match || match[1] !== record.id) throw new ProjectError('Invalid managed image URL.');
		if (manifest) {
			if (typeof record.sha256 !== 'string' || !digestPattern.test(record.sha256))
				throw new ProjectError('Invalid managed image digest.');
		} else if (typeof record.data !== 'string') {
			throw new ProjectError('Managed image data is required.');
		}
	} else if (record.sha256 !== undefined || record.data !== undefined) {
		throw new ProjectError('Linked images cannot contain managed image data.');
	}
	return record as ManifestImage & { data?: string };
}

/** Canonical encoding avoids permissive base64 decoding and bounds allocation before decoding. */
function decodeImage(image: ImageExportRecord): Buffer {
	const data = image.data;
	if (
		typeof data !== 'string' ||
		data.length === 0 ||
		data.length > Math.ceil(maxImageBytes / 3) * 4 ||
		data.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
	)
		throw new ProjectError('Invalid or oversized managed image data.');
	const bytes = Buffer.from(data, 'base64');
	if (bytes.length > maxImageBytes || bytes.toString('base64') !== data)
		throw new ProjectError('Invalid or oversized managed image data.');
	if (image.size !== undefined && image.size !== bytes.length)
		throw new ProjectError('Managed image size does not match its data.');
	return bytes;
}

function imageDigest(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Parse all entries together, rejecting duplicates and extra fields rather than partially importing. */
function validateImageManifest(value: unknown): ImageManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ProjectError('Invalid image manifest.');
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some((key) => !['generator', 'version', 'images'].includes(key)) ||
		record.generator !== 'svelte-editor' ||
		record.version !== 1 ||
		!Array.isArray(record.images) ||
		record.images.length > maxImageCount
	)
		throw new ProjectError('Invalid or unsupported image manifest.');
	const ids = new Set<string>();
	const urls = new Set<string>();
	const images = record.images.map((item) => {
		const image = validateImage(item, true);
		if (ids.has(image.id) || (image.kind === 'managed' && urls.has(image.url)))
			throw new ProjectError('Duplicate image in manifest.');
		ids.add(image.id);
		if (image.kind === 'managed') urls.add(image.url);
		return image;
	});
	return { generator: 'svelte-editor', version: 1, images };
}

/** Check each fixed directory component with lstat; never resolve a symlink into another tree. */
async function mediaDirectory(root: string, create: boolean): Promise<boolean> {
	let current = root;
	for (const part of ['static', 'media']) {
		current = path.join(current, part);
		let stat;
		try {
			stat = await lstat(current);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			if (!create) return false;
			await mkdir(current);
			stat = await lstat(current);
		}
		if (!stat.isDirectory()) throw new ProjectError(`Image path ${part} is not a normal folder.`);
	}
	return true;
}

/**
 * Open the final component with O_NOFOLLOW and read at most limit + 1 bytes, including if the
 * file grows after stat. Parent components are checked separately before every access.
 */
async function readMediaFile(
	root: string,
	name: string,
	limit: number
): Promise<Buffer | undefined> {
	if (!(await mediaDirectory(root, false))) return undefined;
	const file = path.join(root, 'static', 'media', name);
	let handle;
	try {
		handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw new ProjectError(`Cannot safely open image file ${name}.`);
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > limit)
			throw new ProjectError(`Image file ${name} is not a bounded regular file.`);
		const buffer = Buffer.alloc(stat.size + 1);
		let offset = 0;
		while (offset < buffer.length) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		if (offset > stat.size) throw new ProjectError(`Image file ${name} changed while reading.`);
		return buffer.subarray(0, offset);
	} finally {
		await handle.close();
	}
}

async function readImageManifest(root: string): Promise<ImageManifest | undefined> {
	const bytes = await readMediaFile(root, path.basename(imageManifestFile), maxImageManifestBytes);
	if (!bytes) return undefined;
	try {
		return validateImageManifest(JSON.parse(bytes.toString('utf8')));
	} catch (error) {
		throw new ProjectError(
			`Invalid image manifest: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** Read the complete snapshot or fail; never expose a partial set when bytes are missing. */
async function importImages(root: string): Promise<ImageExportRecord[] | undefined> {
	const manifest = await readImageManifest(root);
	if (!manifest) return undefined;
	let total = 0;
	const images: ImageExportRecord[] = [];
	for (const { sha256, ...image } of manifest.images) {
		if (image.kind === 'link') {
			images.push(image);
			continue;
		}
		const bytes = await readMediaFile(root, image.url.slice('/media/'.length), maxImageBytes);
		if (
			!bytes ||
			bytes.length === 0 ||
			imageDigest(bytes) !== sha256 ||
			(image.size !== undefined && image.size !== bytes.length)
		)
			throw new ProjectError(`Missing or invalid managed image ${image.url}.`);
		total += bytes.length;
		if (total > maxTotalImageBytes) throw new ProjectError('Image library is too large.');
		images.push({ ...image, data: bytes.toString('base64') });
	}
	return images;
}

/**
 * Export a complete snapshot only after preflighting every destination. Existing image bytes are
 * immutable unless identical; this conservative policy also protects edited generated assets.
 * A prior valid editor manifest is the only non-identical manifest we will replace.
 */
async function exportImages(
	root: string,
	input: ImageExportRecord[],
	result: ExportResult
): Promise<void> {
	if (!Array.isArray(input) || input.length > maxImageCount)
		throw new ProjectError('Invalid or oversized image library.');
	const files = new Map<string, Buffer>();
	const entries: ManifestImage[] = [];
	let total = 0;
	for (const value of input) {
		const { data, ...image } = validateImage(value, false);
		if (image.kind === 'managed') {
			const bytes = decodeImage({ ...image, data });
			total += bytes.length;
			if (total > maxTotalImageBytes) throw new ProjectError('Image library is too large.');
			files.set(image.url.slice('/media/'.length), bytes);
			entries.push({ ...image, sha256: imageDigest(bytes) });
		} else {
			entries.push(image);
		}
	}
	const manifest = validateImageManifest({
		generator: 'svelte-editor',
		version: 1,
		images: entries
	});
	const content = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	if (content.length > maxImageManifestBytes)
		throw new ProjectError('Image manifest is too large.');

	let existingManifest: Buffer | undefined;
	try {
		existingManifest = await readMediaFile(
			root,
			path.basename(imageManifestFile),
			maxImageManifestBytes
		);
		if (existingManifest && !existingManifest.equals(content)) {
			// Ownership requires both the marker and matching digests for every managed entry.
			await importImages(root);
		}
	} catch (error) {
		result.skipped.push({
			file: imageManifestFile,
			reason: `unsafe or unrecognized manifest: ${error instanceof Error ? error.message : error}`
		});
		return;
	}
	for (const [name, bytes] of files) {
		try {
			const existing = await readMediaFile(root, name, maxImageBytes);
			if (existing && !existing.equals(bytes))
				result.skipped.push({
					file: path.join('static', 'media', name),
					reason: 'image exists with different content'
				});
		} catch (error) {
			result.skipped.push({
				file: path.join('static', 'media', name),
				reason: `unsafe image destination: ${error instanceof Error ? error.message : error}`
			});
		}
	}
	if (result.skipped.length) {
		result.skipped.push({
			file: imageManifestFile,
			reason: 'image snapshot not exported because of conflicts'
		});
		return;
	}
	await mediaDirectory(root, true);
	for (const [name, bytes] of files) {
		// Exclusive creation prevents races from replacing an unrelated file after preflight.
		const existing = await readMediaFile(root, name, maxImageBytes);
		if (existing) {
			if (!existing.equals(bytes)) throw new ProjectError(`Image destination changed: ${name}.`);
			continue;
		}
		const handle = await open(
			path.join(root, 'static', 'media', name),
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o644
		);
		try {
			await handle.writeFile(bytes);
		} finally {
			await handle.close();
		}
		result.written.push(path.join('static', 'media', name));
	}
	// Recheck all referenced bytes before publishing metadata, including already existing files.
	for (const [name, bytes] of files) {
		const existing = await readMediaFile(root, name, maxImageBytes);
		if (!existing || !existing.equals(bytes))
			throw new ProjectError(`Managed image changed during export: ${name}.`);
	}
	if (!existingManifest || !existingManifest.equals(content)) {
		// Open without following links and compare again through the same descriptor before overwrite.
		const flags = existingManifest
			? constants.O_RDWR
			: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
		const handle = await open(
			path.join(root, imageManifestFile),
			flags | constants.O_NOFOLLOW,
			0o644
		);
		try {
			if (existingManifest) {
				const stat = await handle.stat();
				if (
					!stat.isFile() ||
					stat.size > maxImageManifestBytes ||
					!(await handle.readFile()).equals(existingManifest)
				)
					throw new ProjectError('Image manifest changed during export.');
				await handle.truncate(0);
				let offset = 0;
				while (offset < content.length) {
					const { bytesWritten } = await handle.write(
						content,
						offset,
						content.length - offset,
						offset
					);
					if (!bytesWritten) throw new ProjectError('Could not write the image manifest.');
					offset += bytesWritten;
				}
			} else {
				await handle.writeFile(content);
			}
		} finally {
			await handle.close();
		}
		result.written.push(imageManifestFile);
	}
}

/**
 * Validates that `root` is a valid, existing SvelteKit project directory.
 *
 * Checks for:
 * - Absolute path and no null bytes.
 * - Existence on disk via `realpath`.
 * - Presence of `package.json` file.
 * - Presence of `src/routes` directory.
 *
 * @param root - Absolute path to the candidate directory.
 * @returns Canonical resolved absolute path.
 * @throws {ProjectError} If validation fails.
 */
export async function resolveProject(root: unknown): Promise<string> {
	if (typeof root !== 'string' || root.trim() === '' || root.length > 500 || root.includes('\0')) {
		throw new ProjectError('Enter the absolute path of a SvelteKit project folder.');
	}
	if (!path.isAbsolute(root)) throw new ProjectError('The project path must be absolute.');

	let real: string;
	try {
		real = await realpath(root);
	} catch {
		throw new ProjectError('That folder does not exist.');
	}

	const hasPackage = await isFile(path.join(real, 'package.json'));
	const hasRoutes = await isDirectory(path.join(real, 'src', 'routes'));
	if (!hasPackage || !hasRoutes) {
		throw new ProjectError(
			'That folder is not a SvelteKit project (package.json and src/routes are required).'
		);
	}
	return real;
}

/** Checks whether a path exists and is a regular file. */
async function isFile(file: string): Promise<boolean> {
	return lstat(file).then(
		(stat) => stat.isFile(),
		() => false
	);
}

/** Checks whether a path exists and is a directory. */
async function isDirectory(dir: string): Promise<boolean> {
	return lstat(dir).then(
		(stat) => stat.isDirectory(),
		() => false
	);
}

/**
 * Recursively creates parent directories within the project root.
 * Guarantees no escape outside the project root boundaries.
 */
async function ensureDirectory(root: string, dir: string): Promise<void> {
	const relative = path.relative(root, dir);
	if (relative.startsWith('..') || path.isAbsolute(relative))
		throw new ProjectError('Invalid path.');

	let current = root;
	for (const part of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		const stat = await lstat(current).catch(() => null);
		if (!stat) await mkdir(current);
		else if (!stat.isDirectory()) throw new ProjectError(`${part} is not a normal folder.`);
	}
}

/**
 * Writes file content safely. If a destination file already exists, it is only
 * overwritten if it begins with the editor's generated marker comment.
 *
 * @param root - Canonical project root path.
 * @param file - Target absolute file path.
 * @param content - File contents to write.
 * @param result - ExportResult accumulator.
 */
async function writeGenerated(
	root: string,
	file: string,
	content: string,
	result: ExportResult
): Promise<void> {
	const relative = path.relative(root, file);
	const stat = await lstat(file).catch(() => null);

	if (stat) {
		if (!stat.isFile()) {
			result.skipped.push({ file: relative, reason: 'not a regular file' });
			return;
		}
		const existing = await readFile(file, 'utf8');
		if (!existing.startsWith('<!-- @svelte-editor') && !existing.startsWith(generatedTsMarker)) {
			result.skipped.push({
				file: relative,
				reason: 'exists and was not generated by the editor'
			});
			return;
		}
	}

	await ensureDirectory(root, path.dirname(file));
	await writeFile(file, content);
	result.written.push(relative);
}

/**
 * Exports an entire EditorSite to a real SvelteKit application directory.
 *
 * Writes:
 * - All built-in components to `src/lib/components/editor/<Name>.svelte`.
 * - All site pages to `src/routes/<slug>/+page.svelte`.
 * - The site theme: `src/lib/theme.ts` (helpers) and `src/lib/site-theme.ts` (the chosen values).
 *
 * @param rootInput - Absolute path to target SvelteKit project.
 * @param site - EditorSite model containing pages to export.
 * @param theme - Site theme values copied into the generated theme module.
 * @param options - Import style, widget overrides, and optional complete image snapshot.
 * @returns Result object with lists of written and skipped files.
 * @throws {ProjectError} For invalid project or image data; image conflicts appear in `skipped`.
 */
export async function exportSite(
	rootInput: unknown,
	site: EditorSite,
	theme: SiteTheme = defaultSiteTheme,
	options: ExportSiteOptions = {}
): Promise<ExportResult> {
	const root = await resolveProject(rootInput);
	const importStyle = options.libImportStyle ?? 'sveltekit';
	const result: ExportResult = { written: [], skipped: [], warnings: [] };
	const componentDir = path.join(root, 'src', 'lib', 'components', 'editor');

	if (options.images !== undefined) await exportImages(root, options.images, result);

	// Export all built-in components & widgets as real native Name.svelte components
	for (const name of Object.values(componentNames)) {
		// User-edited versions of the project (`.data/widgets/<projectId>`) win over the built-in defaults.
		const source = await effectiveWidgetSource(name, options.widgetProjectId);
		if (source !== undefined) {
			await writeGenerated(
				root,
				path.join(componentDir, `${name}.svelte`),
				`${generatedMarker}\n${source}`,
				result
			);
		}
	}

	// Composite components are generated files like pages: hand-written files are never replaced.
	for (const composite of site.composites) {
		if (!compositeNamePattern.test(composite.name)) {
			throw new ProjectError(`Invalid composite name "${composite.name}".`);
		}
		await writeGenerated(
			root,
			path.join(componentDir, `${composite.name}.svelte`),
			renderCompositeSource(composite, importStyle),
			result
		);
	}

	const scope = componentSources['../components/editor/ThemeScope.svelte'];
	if (scope !== undefined) {
		await writeGenerated(
			root,
			path.join(componentDir, 'ThemeScope.svelte'),
			`${generatedMarker}\n${scope}`,
			result
		);
	}

	// Theme module + the concrete theme values consumed by every exported page's ThemeScope.
	const libDir = path.join(root, 'src', 'lib');
	await writeGenerated(
		root,
		path.join(libDir, 'theme.ts'),
		`${generatedTsMarker}\n${themeSource}`,
		result
	);
	await writeGenerated(
		root,
		path.join(libDir, 'site-theme.ts'),
		`${generatedTsMarker}\nimport type { SiteTheme } from './theme';\n\nexport const siteTheme: SiteTheme = ${JSON.stringify(normalizeSiteTheme(theme), null, '\t')};\n`,
		result
	);

	// The exported widgets import `flowbite-svelte`; tell the user if the target cannot resolve it.
	const manifest = await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '');
	if (!manifest.includes('"flowbite-svelte"')) {
		result.warnings.push(
			'The target project does not list "flowbite-svelte". Run `npm i -D flowbite-svelte flowbite` and add an `@source` for flowbite-svelte and a `--color-primary-*` theme scale to your Tailwind CSS.'
		);
	}

	for (const page of site.pages) {
		if (!slugPattern.test(page.slug)) throw new ProjectError(`Invalid route "${page.slug}".`);
		const file = path.join(root, 'src', 'routes', page.slug, '+page.svelte');
		await writeGenerated(root, file, renderPageSource(page, importStyle), result);
	}

	return result;
}

/**
 * Recursively scans a directory for native `.svelte` files and extracts their component metadata.
 */
async function scanComponents(
	dir: string,
	root: string,
	found: ParsedComponentMetadata[] = []
): Promise<ParsedComponentMetadata[]> {
	const exists = await isDirectory(dir);
	if (!exists) return found;

	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory() && !entry.name.startsWith('.')) {
			await scanComponents(full, root, found);
		} else if (entry.isFile() && entry.name.endsWith('.svelte')) {
			try {
				const src = await readFile(full, 'utf8');
				// Generated composites are imported as composites, not as opaque custom components.
				if (src.includes('data-editor-composite=')) continue;
				const meta = parseSvelteComponent(src, entry.name);
				found.push(meta);
			} catch {
				// Ignore parse errors for non-standard or malformed files
			}
		}
	}
	return found;
}

/**
 * Imports editor pages and native Svelte components from a real SvelteKit application directory.
 *
 * Scans:
 * - `src/lib/components/` for all `.svelte` components.
 * - `src/routes/` for valid editor `+page.svelte` files.
 * - Optional `static/media/.svelte-editor-images.json` and its managed files. Import validates
 *   integrity and bounds, not image safety: the caller must sanitize before storing or serving.
 *
 * @param rootInput - Absolute path to candidate SvelteKit project directory.
 * @returns Discovered pages, parsed component descriptors, and skipped file reports.
 * @throws {ProjectError} If the image snapshot is unsafe, malformed, or incomplete.
 */
export async function importSite(rootInput: unknown): Promise<ImportResult> {
	const root = await resolveProject(rootInput);
	const routes = path.join(root, 'src', 'routes');
	const componentsDir = path.join(root, 'src', 'lib', 'components');

	const components = await scanComponents(componentsDir, root);
	const result: ImportResult = { pages: [], composites: [], components, skipped: [] };
	const images = await importImages(root);
	if (images !== undefined) result.images = images;

	// Composites first: pages and other composites need their names to recognise instances.
	const compositeFiles: { file: string; source: string }[] = [];
	const editorDir = path.join(componentsDir, 'editor');
	for (const entry of (await readdir(editorDir, { withFileTypes: true }).catch(() => [])).sort(
		(a, b) => a.name.localeCompare(b.name)
	)) {
		if (!entry.isFile() || !entry.name.endsWith('.svelte')) continue;
		const file = path.join(editorDir, entry.name);
		const source = await readFile(file, 'utf8');
		if (source.includes('data-editor-composite=')) compositeFiles.push({ file, source });
	}
	const compositeNames = new Set(
		compositeFiles
			.map(({ source }) => /data-editor-composite="([A-Za-z0-9]+)"/.exec(source)?.[1])
			.filter((name): name is string => name !== undefined)
	);
	for (const { file, source } of compositeFiles) {
		const composite = parseCompositeSource(source, compositeNames);
		if (composite && result.composites.length < 50) result.composites.push(composite);
		else
			result.skipped.push({
				file: path.relative(root, file),
				reason: 'could not be read as a composite component'
			});
	}

	for (const entry of (await readdir(routes, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		if (!entry.isDirectory() || !slugPattern.test(entry.name)) continue;
		const file = path.join(routes, entry.name, '+page.svelte');
		const stat = await lstat(file).catch(() => null);
		if (!stat?.isFile()) continue;

		const source = await readFile(file, 'utf8');
		if (!source.includes('data-editor-page')) continue;

		const page = parsePageSource(source, entry.name, compositeNames);
		if (page) result.pages.push(page);
		else
			result.skipped.push({
				file: path.relative(root, file),
				reason: 'could not be read as an editor page'
			});
	}

	if (result.pages.length > 20) {
		result.skipped.push(
			...result.pages.slice(20).map((page) => ({ file: page.slug, reason: 'more than 20 pages' }))
		);
		result.pages = result.pages.slice(0, 20);
	}
	return result;
}

/**
 * Exports a single built-in component into a target SvelteKit project.
 *
 * @param rootInput - Absolute path to target SvelteKit project.
 * @param componentName - Name of the component (e.g. 'WidgetSlider').
 * @param widgetProjectId - Project whose widget overrides apply.
 * @returns Relative path of written component file.
 */
export async function exportSingleComponent(
	rootInput: unknown,
	componentName: string,
	widgetProjectId?: string
): Promise<{ written: string }> {
	const root = await resolveProject(rootInput);
	const source = await effectiveWidgetSource(componentName, widgetProjectId);
	if (!source) throw new ProjectError(`Component "${componentName}" not found.`);

	const targetDir = path.join(root, 'src', 'lib', 'components', 'editor');
	await ensureDirectory(root, targetDir);
	const targetFile = path.join(targetDir, `${componentName}.svelte`);
	await writeFile(targetFile, `${generatedMarker}\n${source}`);
	return { written: path.relative(root, targetFile) };
}

/**
 * Imports and parses a single `.svelte` component file from a project.
 *
 * @param rootInput - Absolute path to target SvelteKit project.
 * @param componentRelativePath - Path to the component relative to the project root.
 * @returns Parsed component metadata.
 */
export async function importSingleComponent(
	rootInput: unknown,
	componentRelativePath: string
): Promise<ParsedComponentMetadata> {
	const root = await resolveProject(rootInput);
	const full = path.resolve(root, componentRelativePath);
	if (!full.startsWith(root) || !full.endsWith('.svelte')) {
		throw new ProjectError('Invalid component path.');
	}

	const source = await readFile(full, 'utf8');
	return parseSvelteComponent(source, path.basename(full));
}

export { componentNames };
