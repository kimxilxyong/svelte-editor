/**
 * @fileoverview Component editor file API.
 *
 * `POST /component-editor/api`
 *
 * JSON actions (all take `root`, the absolute SvelteKit project folder chosen by the user):
 * - `list`   → `{ root, files: { path, size }[], truncated }` for `src/lib/components/**.svelte`.
 * - `read`   → `{ content }` for `path` (relative to `src/lib/components`).
 * - `save`   → writes `content` to an existing `path`. Responds `{ saved, diagnostics }`; when the
 *              compiler finds errors and `force` is not `true`, nothing is written (`saved: false`).
 * - `create` → like `save` but for a new file; never overwrites.
 *
 * All path and symlink safety is implemented in `lib/server/component-files.ts`.
 * `ProjectError`s become HTTP 400 with a user-presentable `error`; anything else is a 500.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ProjectError } from '../../../lib/server/project.js';
import {
	listComponentFiles,
	readComponentFile,
	saveComponentFile
} from '../../../lib/server/component-files.js';

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
	const { action, root, path, content, force } = body as Record<string, unknown>;

	try {
		if (action === 'list') return json(await listComponentFiles(root));
		if (action === 'read') return json({ content: await readComponentFile(root, path) });
		if (action === 'save' || action === 'create') {
			return json(
				await saveComponentFile(root, path, content, {
					force: force === true,
					create: action === 'create'
				})
			);
		}
		return json({ error: 'Unknown action.' }, { status: 400 });
	} catch (error) {
		if (error instanceof ProjectError) return json({ error: error.message }, { status: 400 });
		console.error('Component editor request failed.', error);
		return json({ error: 'The component files could not be read or written.' }, { status: 500 });
	}
};
