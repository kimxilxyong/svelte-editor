/**
 * @fileoverview Reactive navigation state shared by every route (`.svelte.ts` module).
 *
 * ## Responsibilities
 * 1. **Trail** – mirrors the browser session history ({@link TrailState}) so the UI can show
 *    where the user was, is, and could go forward. Updated from the root layout through
 *    {@link trackNavigation}; persisted in `sessionStorage` so a reload keeps the trail.
 * 2. **Page names** – remembers `page id → name` so history entries and breadcrumbs of the
 *    editor can show `Editor · About` instead of a raw id.
 * 3. **Unsaved-changes flag** – the active route reports whether leaving would lose edits;
 *    the root layout reads it in `beforeNavigate` to ask for confirmation.
 *
 * ## Why one module-level object?
 * Route components are destroyed and re-created on every navigation, but this module lives
 * for the whole session, so the trail survives route changes.
 *
 * ## Back/forward = the browser's own history
 * {@link goBack}/{@link goForward}/{@link goToEntry} use `history.go()`, therefore the
 * app buttons and the browser buttons are literally the same operation and cannot diverge.
 *
 * @see navigation-trail.ts for the pure, unit-tested logic.
 */

import { browser } from '$app/env';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import {
	advanceTrail,
	backTarget,
	editorPath,
	emptyTrail,
	forwardTarget,
	parseTrail,
	splitPath,
	type NavigationKind,
	type TrailState
} from './navigation-trail.js';

const storageKey = 'page-builder:navigation-trail';

/** Reads the persisted trail from `sessionStorage` (tab-scoped, like the history itself). */
function loadTrail(): TrailState {
	if (!browser) return emptyTrail;
	try {
		return parseTrail(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')) ?? emptyTrail;
	} catch {
		return emptyTrail;
	}
}

/** Reactive navigation state. Treat as read-only outside this module. */
export const nav = $state({
	/** Mirror of the browser history, see {@link TrailState}. */
	trail: loadTrail(),
	/** Map of page id → page name for labels. */
	pageNames: {} as Record<string, string>,
	/** Id of the page most recently opened in the editor (target of the "Editor" tab). */
	lastEditorPageId: null as string | null,
	/** `true` while the active route holds edits that were not saved. */
	unsavedChanges: false
});

/**
 * Feeds a completed navigation into the trail. Call from `afterNavigate` in the root layout.
 *
 * @param kind - SvelteKit navigation type.
 * @param path - The path now shown (`pathname + search`).
 * @param delta - Browser history delta for `popstate` navigations.
 */
export function trackNavigation(kind: NavigationKind, path: string, delta?: number | null) {
	nav.trail = advanceTrail(nav.trail, kind, path, delta);
	const { pathname, pageId } = splitPath(path);
	if (pathname === editorPath && pageId) nav.lastEditorPageId = pageId;
	if (!browser) return;
	try {
		sessionStorage.setItem(storageKey, JSON.stringify($state.snapshot(nav.trail)));
	} catch {
		// Storage can be unavailable (private mode / quota); the in-memory trail still works.
	}
}

/**
 * Registers the known pages so labels can use names.
 *
 * @param pages - Pages with their ids and display names.
 */
export function rememberPages(pages: readonly { id: string; name: string }[]) {
	if (pages.length === 0) return;
	nav.pageNames = Object.fromEntries(pages.map((page) => [page.id, page.name]));
}

/** Moves one step back: browser history when possible, otherwise to the logical parent. */
export async function goBack(currentPath: string) {
	const target = backTarget(nav.trail, currentPath);
	if (!target) return;
	if (target.kind === 'history') history.back();
	else await goto(resolve('/'));
}

/** Moves one step forward in the browser history, if there is a forward entry. */
export function goForward() {
	if (forwardTarget(nav.trail) !== null) history.forward();
}

/**
 * Jumps to an entry of the trail (any number of steps back or forward at once).
 *
 * @param index - Index into `nav.trail.entries`.
 */
export function goToEntry(index: number) {
	const delta = index - nav.trail.index;
	if (delta !== 0 && index >= 0 && index < nav.trail.entries.length) history.go(delta);
}
