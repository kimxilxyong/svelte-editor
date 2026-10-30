/**
 * @fileoverview Pure helpers for the in-app navigation trail (framework independent).
 *
 * ## Purpose
 * The browser's session history is write-only for scripts: the app cannot read which URLs
 * are behind or ahead of the current entry. To show the user "where I was / where I am /
 * where I can go forward", the app mirrors the browser history in a {@link TrailState}:
 * a list of visited paths plus a pointer (`index`) to the entry that is currently shown.
 *
 * ## Model
 * - `entries[index]` is always the current location.
 * - `entries[0 .. index-1]` are locations the browser Back button reaches (oldest first).
 * - `entries[index+1 ..]` are locations the browser Forward button reaches.
 *
 * ## Synchronisation rules (see {@link advanceTrail})
 * | SvelteKit navigation `type`   | Effect on the trail                                        |
 * | ----------------------------- | ---------------------------------------------------------- |
 * | `enter` (first load / reload) | keep a restored trail when it matches, otherwise reset     |
 * | `link` / `goto` / `form`      | drop forward entries, push the new path, move pointer +1   |
 * | `popstate` (back / forward)   | move the pointer by `delta`, re-syncing by path if needed  |
 * | `leave`                       | unchanged (the app is being left)                          |
 *
 * Every function here is pure and side-effect free so it can be unit tested without a
 * browser. The reactive wrapper lives in `navigation.svelte.ts`.
 *
 * A "path" in this module is `pathname + search` (the hash is ignored on purpose).
 */

/** Navigation types reported by SvelteKit's `afterNavigate` (`Navigation['type']`). */
export type NavigationKind = 'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate';

/** Mirror of the browser session history that belongs to this app. */
export interface TrailState {
	/** Visited paths, oldest first. */
	entries: string[];
	/** Index of the current location inside `entries` (`-1` only for an empty trail). */
	index: number;
}

/** A human readable description of a path. */
export interface PathDescription {
	/** Short label, for example `Pages` or `Editor · Home`. */
	label: string;
	/** Coarse area of the app, used for icons and grouping. */
	section: 'pages' | 'editor' | 'components' | 'auth' | 'account' | 'admin' | 'other';
}

/** One breadcrumb segment. `path` is `null` for the current (non-clickable) segment. */
export interface Breadcrumb {
	label: string;
	path: string | null;
}

/** Result of {@link backTarget}: how the app Back button should behave right now. */
export type BackTarget =
	{ kind: 'history'; path: string; delta: -1 } | { kind: 'parent'; path: string } | null;

/** Maximum number of remembered entries; the oldest entries are dropped first. */
export const maxTrailLength = 50;

/** The path of the page list (home). */
export const pagesPath = '/';

/** The base path of the single-page editor. */
export const editorPath = '/editor';

/** Path of the Svelte source (component) editor. */
export const componentEditorPath = '/component-editor';

/**
 * Fixed labels of the authentication / administration routes (exact pathname match).
 * `/admin/users` is deliberately listed explicitly: the generic fallback below would
 * label it `Users` anyway, but the admin pages rely on this table as the contract.
 */
const authPathLabels: Record<string, PathDescription> = {
	'/login': { label: 'Sign in', section: 'auth' },
	'/register': { label: 'Register', section: 'auth' },
	'/setup': { label: 'Setup', section: 'auth' },
	'/account': { label: 'Account', section: 'account' },
	'/theme': { label: 'Theme', section: 'other' },
	'/admin': { label: 'Admin', section: 'admin' },
	'/admin/users': { label: 'Users', section: 'admin' }
};

/** An empty trail, used before the first navigation was observed. */
export const emptyTrail: TrailState = { entries: [], index: -1 };

/**
 * Builds a comparable path (`pathname + search`) from a URL, ignoring the hash.
 *
 * @param url - Any object with `pathname` and `search`, e.g. a `URL`.
 * @returns The path used as the identity of a history entry.
 */
export function toPath(url: { pathname: string; search: string }): string {
	return `${url.pathname}${url.search}`;
}

/**
 * Splits a path into its pathname and `page` query parameter.
 *
 * @param path - A path as produced by {@link toPath}.
 * @returns The pathname and the value of `?page=` (or `null`).
 */
export function splitPath(path: string): { pathname: string; pageId: string | null } {
	const queryStart = path.indexOf('?');
	const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
	const query = queryStart === -1 ? '' : path.slice(queryStart + 1);
	return { pathname, pageId: new URLSearchParams(query).get('page') };
}

/**
 * Builds the editor path for a page id.
 *
 * @param pageId - The id of the page to edit, or `null` for the bare editor path.
 * @returns `/editor?page=<id>` or `/editor`.
 */
export function editorPathFor(pageId: string | null): string {
	return pageId ? `${editorPath}?page=${encodeURIComponent(pageId)}` : editorPath;
}

/**
 * Applies one observed navigation to the trail and returns the new trail.
 *
 * @param state - The trail before the navigation.
 * @param kind - The SvelteKit navigation type that just completed.
 * @param path - The path that is now being shown.
 * @param delta - For `popstate`: how many history entries the browser moved (negative = back).
 * @returns The updated trail; the same object when nothing changed.
 */
export function advanceTrail(
	state: TrailState,
	kind: NavigationKind,
	path: string,
	delta?: number | null
): TrailState {
	if (kind === 'leave') return state;

	if (kind === 'enter') {
		return state.entries[state.index] === path ? state : { entries: [path], index: 0 };
	}

	if (kind === 'popstate') return resyncTrail(state, path, delta ?? 0);

	// link / goto / form: a brand new history entry. Forward entries are discarded,
	// exactly like the browser does when you navigate after going back.
	if (state.entries[state.index] === path) return state;
	const entries = [...state.entries.slice(0, state.index + 1), path];
	const overflow = Math.max(0, entries.length - maxTrailLength);
	return { entries: entries.slice(overflow), index: entries.length - overflow - 1 };
}

/**
 * Moves the pointer after a back/forward navigation. The expected position is
 * `index + delta`; if the path found there differs (history entries created by
 * `replaceState`, other tabs, ...) the nearest entry with the same path wins, and
 * as a last resort the trail restarts at the current path.
 */
function resyncTrail(state: TrailState, path: string, delta: number): TrailState {
	const expected = state.index + delta;
	if (state.entries[expected] === path) return { entries: state.entries, index: expected };

	let best = -1;
	for (let i = 0; i < state.entries.length; i += 1) {
		if (state.entries[i] !== path) continue;
		if (best === -1 || Math.abs(i - expected) < Math.abs(best - expected)) best = i;
	}
	return best === -1 ? { entries: [path], index: 0 } : { entries: state.entries, index: best };
}

/**
 * Validates an unknown value (for example parsed from `sessionStorage`) as a trail.
 *
 * @param raw - Untrusted value.
 * @returns A sanitised {@link TrailState}, or `null` when the value is unusable.
 */
export function parseTrail(raw: unknown): TrailState | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const { entries, index } = raw as Partial<TrailState>;
	if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) return null;
	if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= entries.length) {
		return null;
	}
	return { entries: entries.slice(-maxTrailLength), index: index as number };
}

/**
 * Describes a path for humans.
 *
 * @param path - A path as produced by {@link toPath}.
 * @param pageNames - Map of page id → page name, used for `/editor?page=<id>`.
 * @returns A short label and the app section.
 */
export function describePath(
	path: string,
	pageNames: Record<string, string> = {}
): PathDescription {
	const { pathname, pageId } = splitPath(path);
	if (pathname === pagesPath) return { label: 'Pages', section: 'pages' };
	if (pathname === editorPath) {
		const name = pageId ? pageNames[pageId] : undefined;
		return { label: name ? `Editor · ${name}` : 'Editor', section: 'editor' };
	}
	if (pathname === componentEditorPath) return { label: 'Component editor', section: 'components' };
	// A trailing slash must not change the label (`/admin/` is the admin page too).
	const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	const known = authPathLabels[normalized];
	if (known) return { ...known };
	const last = pathname.split('/').filter(Boolean).at(-1) ?? pathname;
	return {
		label: last.charAt(0).toUpperCase() + last.slice(1),
		// Any other `/admin/...` page still belongs to the admin section.
		section: normalized.startsWith('/admin/') ? 'admin' : 'other'
	};
}

/**
 * Builds the breadcrumb ("you are here") for a path. The root is always `Pages`.
 *
 * @param path - The current path.
 * @param pageNames - Map of page id → page name.
 * @returns Segments from the root to the current location; the last one has `path: null`.
 */
export function breadcrumbsFor(path: string, pageNames: Record<string, string> = {}): Breadcrumb[] {
	if (splitPath(path).pathname === pagesPath) return [{ label: 'Pages', path: null }];
	return [
		{ label: 'Pages', path: pagesPath },
		{ label: describePath(path, pageNames).label, path: null }
	];
}

/**
 * Decides what the app Back button does.
 *
 * - With a previous trail entry it moves exactly one step back in the browser history
 *   (`history.back()`), so app Back and browser Back are the same operation.
 * - Without one (deep link, reload in a fresh tab) it offers the logical parent
 *   (`Pages`) so the user is never stuck on a dead button, except on `Pages` itself.
 *
 * @param state - The current trail.
 * @param currentPath - The path being shown (used to compute the fallback).
 * @returns The back behaviour, or `null` when there is nowhere to go back to.
 */
export function backTarget(state: TrailState, currentPath: string): BackTarget {
	if (state.index > 0) return { kind: 'history', path: state.entries[state.index - 1], delta: -1 };
	return splitPath(currentPath).pathname === pagesPath ? null : { kind: 'parent', path: pagesPath };
}

/**
 * Returns the entry the browser Forward button reaches, if any.
 *
 * @param state - The current trail.
 */
export function forwardTarget(state: TrailState): string | null {
	return state.entries[state.index + 1] ?? null;
}
