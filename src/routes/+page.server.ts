/**
 * @fileoverview Load function of the Projects page (`/`, the application's home).
 *
 * Returns the projects the signed-in user may see: their own, or – for admins – the projects of all
 * users (each carrying its owner's name). The active project comes from the root layout data.
 * Mutations go through `/projects/api` followed by `invalidateAll()`, so this load re-runs.
 */

import type { PageServerLoad } from './$types';
import { requireUser } from '../lib/server/auth/guard.js';
import { getDatabase } from '../lib/server/database/manager.js';
import { listProjects } from '../lib/server/project-store.js';

/** @returns `{ projects }` – the visible projects, most recently changed first. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, { redirectTo: url.pathname });
	return { projects: await listProjects(await getDatabase(), user) };
};
