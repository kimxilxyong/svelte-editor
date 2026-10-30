/**
 * @fileoverview Svelte context that lets block renderers resolve `composite:<Name>` blocks.
 *
 * A route (editor, composite editor, page overview, theme preview) calls
 * {@link provideComposites} once during component init with a getter for the current composite
 * list. `BlockContent` then calls {@link useComposites} to resolve the definition to render. The
 * getter keeps the lookup reactive: edits to a composite show up in every instance immediately.
 * Context (not a module-level store) keeps server-side rendering free of cross-request state.
 */

import { getContext, setContext } from 'svelte';
import type { EditorComposite } from './editor.js';

const key = Symbol('composites');

/** Maximum nesting depth rendered before an instance degrades to a placeholder (cycle guard). */
export const maxCompositeDepth = 6;

/**
 * Publishes the composites of the current site to all descendant block renderers.
 *
 * @param get - Returns the current composites; called on every lookup so it stays reactive.
 */
export function provideComposites(get: () => EditorComposite[]): void {
	setContext(key, get);
}

/**
 * Reads the composite context. Must be called during component initialisation.
 *
 * @returns A lookup function: PascalCase composite name (the part after `composite:`) → the
 * composite, or `undefined` when no context exists or the name is unknown.
 */
export function useComposites(): (name: string) => EditorComposite | undefined {
	const get = getContext<(() => EditorComposite[]) | undefined>(key);
	return (name) => get?.().find((composite) => composite.name === name);
}
