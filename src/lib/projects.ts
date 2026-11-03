/**
 * @fileoverview Isomorphic project model shared by the server store, the root layout data and the
 * Projects UI.
 *
 * A **Project** is the top-level object a user works on. It owns one site (pages + composite
 * components, see `editor.ts`), one theme and – optionally – the absolute path of the SvelteKit
 * folder the site is exported to. Every user sees only their own projects; admins see all.
 *
 * Interacts with:
 * - `server/project-store.ts` – persistence (the only module touching the project tables).
 * - `routes/+layout.server.ts` – exposes the active {@link ProjectSummary} to every page.
 * - `routes/+page.svelte` (Projects) and `components/AppNav.svelte` (project chip / switcher).
 */

import type { SiteTheme } from './theme.js';

/** Cookie holding the id of the project the user is currently working on (validated per request). */
export const activeProjectCookie = 'active_project';

/** Size limits of project fields; the server re-validates all of them. */
export const projectLimits = {
	/** Maximum characters of a project name. */
	nameLength: 80,
	/** Maximum characters of the description. */
	descriptionLength: 500,
	/** Maximum characters of the SvelteKit folder path. */
	pathLength: 500,
	/** Maximum number of projects a single user may own. */
	perUser: 50
} as const;

/**
 * A project as shown in lists and the navigation. Timestamps are ISO strings.
 *
 * `path` is the absolute SvelteKit folder, or `''` while none is chosen.
 */
export type ProjectSummary = {
	/** Unique id (UUID). */
	id: string;
	/** Id of the owning user. */
	ownerId: string;
	/** Display name of the owner (admins see projects of several users). */
	ownerName: string;
	/** Name, unique per owner. */
	name: string;
	/** Free-form description (may be empty). */
	description: string;
	/** Absolute SvelteKit project folder, or `''`. */
	path: string;
	/** Theme applied to the canvas, previews and exports of this project. */
	theme: SiteTheme;
	/** ISO timestamp of creation. */
	createdAt: string;
	/** ISO timestamp of the last change (settings or site). */
	updatedAt: string;
	/** Number of pages. */
	pageCount: number;
	/** Number of composite components. */
	compositeCount: number;
};

/** Editable project settings (all optional in a patch). */
export type ProjectInput = {
	name: string;
	description?: string;
	path?: string;
	theme?: SiteTheme;
};

/**
 * Normalises a project name: collapses whitespace and trims.
 *
 * @param raw - Untrusted input.
 * @returns The name, or `null` when empty / too long / not a string.
 * @example
 * normalizeProjectName('  My   site '); // 'My site'
 * normalizeProjectName('   '); // null
 */
export function normalizeProjectName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.replace(/\s+/g, ' ').trim();
	return name.length >= 1 && name.length <= projectLimits.nameLength ? name : null;
}

/**
 * Picks a free name by appending `copy`, `copy 2`, … until it is not in `taken`.
 *
 * @param base - Desired name.
 * @param taken - Names the owner already uses (case-insensitive comparison).
 * @returns A name that fits {@link projectLimits.nameLength}.
 * @example
 * uniqueProjectName('Site copy', ['Site copy']); // 'Site copy 2'
 */
export function uniqueProjectName(base: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((name) => name.toLowerCase()));
	const root = base.slice(0, projectLimits.nameLength - 5).trimEnd() || 'Project';
	let candidate = base.slice(0, projectLimits.nameLength);
	let counter = 2;
	while (used.has(candidate.toLowerCase())) candidate = `${root} ${counter++}`;
	return candidate;
}
