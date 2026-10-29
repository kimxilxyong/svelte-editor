import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function isSvelteKitProject(dirPath: string): Promise<boolean> {
	try {
		const pkg = await stat(path.join(dirPath, 'package.json')).catch(() => null);
		const routes = await stat(path.join(dirPath, 'src', 'routes')).catch(() => null);
		return Boolean(pkg?.isFile() && routes?.isDirectory());
	} catch {
		return false;
	}
}

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
