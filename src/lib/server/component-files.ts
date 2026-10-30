/**
 * @fileoverview Safe file access for the component editor (`/component-editor`).
 *
 * The component editor lets a developer open, edit and create `.svelte` files of a real SvelteKit
 * project that the user picked in the folder browser. Because this runs on the local file system
 * with the privileges of the dev server, every operation goes through the guards below:
 *
 * - The project must pass {@link resolveProject} (`package.json` + `src/routes`).
 * - Only files below `<project>/src/lib/components` are reachable ({@link componentsDirectory}).
 * - Only `.svelte` files; every path segment must match {@link segmentPattern} (no `..`, no
 *   hidden files, no separators smuggled in); at most {@link maxFiles} files are listed and
 *   {@link maxFileBytes} bytes are read/written.
 * - Symbolic links are never followed or written through (`lstat` on every segment, and the
 *   canonical path of the parent directory must stay inside the components directory).
 * - **Save** re-runs the Svelte compiler check on the server and refuses to write a file with
 *   compile errors unless `force` is set, so the browser cannot bypass the sanity check by accident.
 * - **Create** never overwrites an existing file.
 *
 * Failures throw {@link ProjectError} with a message that is safe to show to the user.
 * Interactions: used by `routes/component-editor/api/+server.ts`; tested in
 * `component-files.spec.ts` against a temporary directory.
 */

import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkSvelteSource } from '../svelte-diagnostics.js';
import type { SourceDiagnostic } from '../svelte-parts.js';
import { ProjectError, resolveProject } from './project.js';

/** Maximum number of files returned by {@link listComponentFiles}. */
export const maxFiles = 500;
/** Maximum accepted/served file size in bytes. */
export const maxFileBytes = 512 * 1024;
/** Allowed characters of a single path segment. */
const segmentPattern = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
/** Folders that never contain editable sources. */
const ignoredFolders = new Set(['node_modules']);

/** One entry of the component list. */
export type ComponentFileInfo = {
	/** Forward-slash path relative to `src/lib/components`, e.g. `editor/Hero.svelte`. */
	path: string;
	/** Size in bytes. */
	size: number;
};

/** Result of {@link saveComponentFile}. */
export type SaveResult =
	| { saved: true; diagnostics: SourceDiagnostic[] }
	/** Not written because of compile errors; the user may retry with `force`. */
	| { saved: false; diagnostics: SourceDiagnostic[] };

/**
 * Absolute path of the components directory of a resolved project.
 *
 * @param projectRoot - Canonical project root from {@link resolveProject}.
 */
export function componentsDirectory(projectRoot: string): string {
	return path.join(projectRoot, 'src', 'lib', 'components');
}

/**
 * Validates a user supplied relative component path and converts it to an absolute path.
 *
 * @param projectRoot - Canonical project root.
 * @param relative - Forward-slash path relative to the components directory.
 * @returns The absolute path (not yet checked for existence or symlinks).
 * @throws {ProjectError} For anything that is not a plain `*.svelte` path.
 */
export function resolveComponentPath(projectRoot: string, relative: unknown): string {
	if (typeof relative !== 'string' || relative.length === 0 || relative.length > 200) {
		throw new ProjectError('Invalid file name.');
	}
	const segments = relative.split('/');
	if (!segments.every((segment) => segmentPattern.test(segment))) {
		throw new ProjectError(
			'Invalid file name. Use letters, digits, "-", "_" and "." (folders separated by "/").'
		);
	}
	const file = segments[segments.length - 1];
	if (!file.endsWith('.svelte') || file === '.svelte') {
		throw new ProjectError('Only .svelte files can be edited.');
	}
	return path.join(componentsDirectory(projectRoot), ...segments);
}

/**
 * Verifies that `absolute`'s real parent directory is still inside the components directory and
 * that the file itself is not a symbolic link.
 *
 * @throws {ProjectError} When the path escapes through a symlink.
 */
async function assertInside(projectRoot: string, absolute: string): Promise<void> {
	const base = await realpath(componentsDirectory(projectRoot)).catch(() => {
		throw new ProjectError('The project has no src/lib/components folder yet.');
	});
	const parent = await realpath(path.dirname(absolute)).catch(() => null);
	if (parent && parent !== base && !parent.startsWith(base + path.sep)) {
		throw new ProjectError('Invalid path.');
	}
	const stat = await lstat(absolute).catch(() => null);
	if (stat && !stat.isFile()) throw new ProjectError('Not a regular file.');
}

/**
 * Lists every `.svelte` file below `src/lib/components` (depth-first, sorted by path).
 *
 * @param root - Project root as typed by the user.
 * @returns Canonical project root and the files. Empty when the folder does not exist.
 * @throws {ProjectError} If `root` is not a SvelteKit project.
 */
export async function listComponentFiles(
	root: unknown
): Promise<{ root: string; files: ComponentFileInfo[]; truncated: boolean }> {
	const projectRoot = await resolveProject(root);
	const base = componentsDirectory(projectRoot);
	const files: ComponentFileInfo[] = [];
	let truncated = false;

	async function walk(dir: string, prefix: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
			// Dirent.isDirectory()/isFile() are false for symlinks, so links are skipped.
			if (entry.isDirectory()) {
				if (!ignoredFolders.has(entry.name) && segmentPattern.test(entry.name)) {
					await walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
				}
			} else if (
				entry.isFile() &&
				entry.name.endsWith('.svelte') &&
				segmentPattern.test(entry.name)
			) {
				const stat = await lstat(path.join(dir, entry.name));
				files.push({ path: `${prefix}${entry.name}`, size: stat.size });
			}
		}
	}

	await walk(base, '');
	return { root: projectRoot, files, truncated };
}

/**
 * Reads one component file.
 *
 * @param root - Project root.
 * @param relative - Path relative to `src/lib/components`.
 * @returns The UTF-8 text.
 * @throws {ProjectError} If the file is missing, too large or outside the allowed area.
 */
export async function readComponentFile(root: unknown, relative: unknown): Promise<string> {
	const projectRoot = await resolveProject(root);
	const absolute = resolveComponentPath(projectRoot, relative);
	await assertInside(projectRoot, absolute);
	const stat = await lstat(absolute).catch(() => null);
	if (!stat) throw new ProjectError('That file does not exist.');
	if (stat.size > maxFileBytes) throw new ProjectError('That file is too large to edit here.');
	return readFile(absolute, 'utf8');
}

/**
 * Writes a component file after the server-side compiler check.
 *
 * @param root - Project root.
 * @param relative - Path relative to `src/lib/components`.
 * @param content - Complete new file text.
 * @param options.force - Write even when the compiler reports errors (warnings never block).
 * @param options.create - Create a new file instead of replacing one; fails if it exists.
 * @returns `saved: false` with the diagnostics when errors block the write.
 * @throws {ProjectError} On invalid paths, size violations, or creating over an existing file.
 */
export async function saveComponentFile(
	root: unknown,
	relative: unknown,
	content: unknown,
	options: { force?: boolean; create?: boolean } = {}
): Promise<SaveResult> {
	if (typeof content !== 'string') throw new ProjectError('No content to save.');
	if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
		throw new ProjectError('The file is too large to save here.');
	}
	const projectRoot = await resolveProject(root);
	const absolute = resolveComponentPath(projectRoot, relative);

	const check = checkSvelteSource(content, path.basename(absolute));
	if (!check.ok && !options.force) return { saved: false, diagnostics: check.diagnostics };

	if (options.create) {
		await mkdir(path.dirname(absolute), { recursive: true });
	}
	await assertInside(projectRoot, absolute);
	const exists = await lstat(absolute).catch(() => null);
	if (options.create && exists) throw new ProjectError('A file with that name already exists.');
	if (!options.create && !exists) throw new ProjectError('That file does not exist.');

	// `wx` makes creation atomic: it fails instead of overwriting when the file appeared meanwhile.
	await writeFile(absolute, content, { encoding: 'utf8', flag: options.create ? 'wx' : 'w' });
	return { saved: true, diagnostics: check.diagnostics };
}
