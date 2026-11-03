/**
 * @fileoverview The "active project": the project a signed-in user is currently working on.
 *
 * The choice is stored in the HttpOnly cookie `active_project` (see {@link activeProjectCookie}) and
 * **re-validated on every request** in `hooks.server.ts`: the id must belong to the user (admins may
 * pick any project). A missing, stale or foreign id silently falls back to the user's most recently
 * changed own project, or to `null` while the user has none. The result is `event.locals.project`,
 * which every project-scoped endpoint (`/editor/api`, theme, export/import …) uses – request bodies
 * never choose the project.
 */

import type { Cookies } from '@sveltejs/kit';
import { activeProjectCookie, type ProjectSummary } from '../projects.js';
import type { SqlClient } from './database/types.js';
import { defaultProject, getAccessibleProject, type ProjectActor } from './project-store.js';

/**
 * Determines the active project of a request.
 *
 * @param db - Database client.
 * @param actor - Signed-in user.
 * @param cookies - Request cookies; a fallback choice is written back so it stays stable.
 * @param secure - Whether the connection is HTTPS (cookie `secure` flag).
 * @returns The active project or `null` when the user has no project.
 */
export async function resolveActiveProject(
	db: SqlClient,
	actor: ProjectActor,
	cookies: Cookies,
	secure: boolean
): Promise<ProjectSummary | null> {
	const chosen = cookies.get(activeProjectCookie);
	if (chosen) {
		const project = await getAccessibleProject(db, actor, chosen);
		if (project) return project;
	}
	const fallback = await defaultProject(db, actor);
	if (fallback) setActiveProjectCookie(cookies, fallback.id, secure);
	else if (chosen) cookies.delete(activeProjectCookie, { path: '/' });
	return fallback;
}

/**
 * Remembers `projectId` as the active project (the caller has already checked access).
 *
 * @param cookies - Request cookies.
 * @param projectId - Project to activate.
 * @param secure - Whether the connection is HTTPS.
 */
export function setActiveProjectCookie(cookies: Cookies, projectId: string, secure: boolean): void {
	cookies.set(activeProjectCookie, projectId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 365
	});
}
