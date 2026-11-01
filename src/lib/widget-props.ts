/**
 * @fileoverview Common prop contract of the Flowbite widgets that `BlockContent.svelte` renders
 * generically (every widget added after the original compact set).
 *
 * The widget components themselves stay self-contained single files (they are exported one by one
 * into target projects and may be recompiled in the browser from user edits), so they import
 * nothing from `$lib`; each one declares the subset of these props it uses. This type only types
 * the registry in `components/editor/registry.ts`.
 *
 * Entry format of `items` (documented per widget in `inspector-fields.ts`): one entry per line,
 * cells separated by a pipe, e.g. `Profile | Your profile details`. Blank lines are ignored and
 * cells are trimmed.
 */

/**
 * Superset of the props a generically rendered widget may receive from a block. All optional so an
 * exported page only has to pass what a widget uses.
 */
export interface WidgetProps {
	/** Block id, used to build unique element ids. */
	id: string;
	/** Primary text (label, heading, brand …). */
	title: string;
	/** Secondary text (helper, description, message …). */
	body: string;
	/** Third text slot (button label, placeholder, variant keyword …). */
	action: string;
	/** Newline-separated entries, cells separated by `|`. */
	items: string;
	/** Percentage 0–100 for progress-, rating- and step-like widgets. */
	level: number;
	/** Optional link target. */
	href: string;
	/** Open external links in a new tab. */
	newTab: boolean;
	/** Reports a link click so the host can intercept in-app navigation. */
	onnavigate: (event: MouseEvent) => void;
}
