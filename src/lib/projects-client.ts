/**
 * @fileoverview Browser helper for the project API (`/projects/api`), shared by the Projects page
 * and the navigation's project switcher.
 */

import type { ProjectSummary } from './projects.js';

/** Fields of a project that may be changed in one request. */
export type ProjectPatch = Partial<Pick<ProjectSummary, 'name' | 'description' | 'path' | 'theme'>>;

/**
 * Sends one action to `/projects/api`.
 *
 * @param body - `{ action, … }` payload, see the endpoint documentation.
 * @returns The parsed JSON answer.
 * @throws {Error} With the server's message when the request fails.
 */
export async function projectApi<T = { project?: ProjectSummary; deleted?: string }>(
	body: Record<string, unknown>
): Promise<T> {
	const response = await fetch('/projects/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const result = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
	return result;
}
