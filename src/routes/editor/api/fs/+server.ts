/**
 * @fileoverview Filesystem Browser API Endpoint.
 *
 * `GET /editor/api/fs?path=<dir>`
 * `POST /editor/api/fs` with `{ path, name }` creates one child folder.
 *
 * Allows the browser-based UI to browse the local filesystem on the host server
 * in order to select target SvelteKit projects.
 *
 * Features:
 * - Canonical directory resolution via `realpath`.
 * - Parent directory traversal calculation (`parent`).
 * - Automatic SvelteKit project detection on each listed subdirectory by verifying
 *   the presence of both `package.json` and a `src/routes` directory.
 * - Filters out hidden directories (starting with `.`).
 * - Folder creation canonicalises an existing parent, accepts only a single folder name,
 *   and never overwrites existing files, folders or symlinks. Hooks restrict both methods to
 *   power users and apply the shared CSRF policy; this API does not change project selection.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Checks whether a given directory is a valid SvelteKit project.
 *
 * @param dirPath - Directory path to inspect.
 * @returns `true` if `package.json` is a file and `src/routes` is a directory.
 */
async function isSvelteKitProject(dirPath: string): Promise<boolean> {
	try {
		const pkg = await stat(path.join(dirPath, 'package.json')).catch(() => null);
		const routes = await stat(path.join(dirPath, 'src', 'routes')).catch(() => null);
		return Boolean(pkg?.isFile() && routes?.isDirectory());
	} catch {
		return false;
	}
}

/**
 * Handles GET requests to browse directory contents.
 *
 * Query Params:
 * - `path`: Target directory path to browse (defaults to current working directory).
 *
 * Response (JSON):
 * - `current`: Canonical absolute path of the directory.
 * - `parent`: Path of parent directory or null if at root.
 * - `home`: User's home directory path.
 * - `isSvelteKit`: Whether the current directory itself is a SvelteKit project.
 * - `isEmpty`: Whether the current directory is empty, i.e. usable for "create new project".
 * - `directories`: Array of child directories with SvelteKit detection flags.
 */
export const GET: RequestHandler = async ({ url }) => {
	const requestedPath = url.searchParams.get('path')?.trim() || process.cwd();

	try {
		const targetPath = await realpath(path.resolve(requestedPath));
		const targetStat = await stat(targetPath);

		if (!targetStat.isDirectory()) {
			return json({ error: 'Selected path is not a directory.' }, { status: 400 });
		}

		const entries = await readdir(targetPath, { withFileTypes: true });
		const directories = [];

		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith('.')) {
				const fullPath = path.join(targetPath, entry.name);
				const isSvelteKit = await isSvelteKitProject(fullPath);
				directories.push({
					name: entry.name,
					path: fullPath,
					isSvelteKit
				});
			}
		}

		directories.sort((a, b) => a.name.localeCompare(b.name));

		const parent = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
		const isSvelteKit = await isSvelteKitProject(targetPath);
		// Folders that only hold a `.git` directory or `.DS_Store` still count as empty (see new-project.ts).
		const isEmpty = entries.every((entry) => entry.name === '.git' || entry.name === '.DS_Store');

		return json({
			current: targetPath,
			parent,
			home: os.homedir(),
			isSvelteKit,
			isEmpty,
			directories
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to browse directory.' },
			{ status: 400 }
		);
	}
};

/**
 * Creates one new directory inside the folder currently displayed by the picker.
 *
 * @param event - Request event containing JSON `path` (absolute existing parent) and `name`
 *   (one non-empty folder name, with no path separators, NUL or dot traversal segments).
 * @returns JSON `{ path }` with status 201, or a visible `{ error }` response for invalid input,
 *   inaccessible parents or creation failures; existing entries return status 409.
 * @example
 * // POST /editor/api/fs: { "path": "/home/projects", "name": "New project" }
 * // 201: { "path": "/home/projects/New project" }
 */
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
	const { path: parentInput, name: nameInput } = body as Record<string, unknown>;
	if (typeof parentInput !== 'string' || !path.isAbsolute(parentInput)) {
		return json({ error: 'Choose an existing parent folder first.' }, { status: 400 });
	}
	if (
		typeof nameInput !== 'string' ||
		!nameInput.trim() ||
		nameInput.trim() === '.' ||
		nameInput.trim() === '..' ||
		/[/\\\0]/.test(nameInput)
	) {
		return json(
			{ error: 'Enter a folder name without path separators or dot traversal segments.' },
			{ status: 400 }
		);
	}

	try {
		const parent = await realpath(parentInput);
		if (!(await stat(parent)).isDirectory()) {
			return json({ error: 'Selected parent is not a directory.' }, { status: 400 });
		}
		const child = path.join(parent, nameInput.trim());
		// A non-recursive mkdir is atomic and refuses every existing entry, including symlinks.
		await mkdir(child);
		return json({ path: child }, { status: 201 });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
			return json({ error: 'A file or folder with this name already exists.' }, { status: 409 });
		}
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to create folder.' },
			{ status: 400 }
		);
	}
};
