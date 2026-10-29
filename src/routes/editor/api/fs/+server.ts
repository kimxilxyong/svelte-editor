/**
 * @fileoverview Filesystem Browser API Endpoint.
 *
 * `GET /editor/api/fs?path=<dir>`
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
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, stat, realpath } from 'node:fs/promises';
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

		return json({
			current: targetPath,
			parent,
			home: os.homedir(),
			isSvelteKit,
			directories
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to browse directory.' },
			{ status: 400 }
		);
	}
};
