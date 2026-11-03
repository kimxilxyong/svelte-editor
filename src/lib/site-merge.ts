/**
 * @fileoverview Pure merge of pages and composites read from a SvelteKit folder into a project's site.
 *
 * Used by the import action of `routes/editor/api/project/+server.ts`, which then saves the merged
 * site. Rules (unchanged from the former in-browser merge):
 * - A page with the same `slug` replaces the existing page but keeps its id and position.
 * - A composite with the same `name` replaces the existing one but keeps its id.
 * - New pages/composites are appended while the limits (20 pages, 50 composites) allow it; the rest
 *   is dropped and counted in {@link MergeResult.dropped}.
 */

import type { EditorComposite, EditorPage, EditorSite } from './editor.js';

/** Maximum number of pages of a site (mirrors `parseEditorSite`). */
export const maxPages = 20;
/** Maximum number of composites of a site (mirrors `parseComposites`). */
export const maxCompositeCount = 50;

/** Outcome of {@link mergeImportedSite}. */
export type MergeResult = {
	/** The merged site; the inputs are not modified. */
	site: EditorSite;
	/** Imported pages/composites that did not fit within the limits. */
	dropped: number;
};

/**
 * Merges imported content into an existing site.
 *
 * @param site - Current site of the project.
 * @param imported - Pages and composites read from the folder.
 * @returns The merged site and the number of dropped items.
 * @example
 * mergeImportedSite({ pages: [], composites: [] }, { pages: [page], composites: [] }).site.pages.length; // 1
 */
export function mergeImportedSite(
	site: EditorSite,
	imported: { pages: EditorPage[]; composites: EditorComposite[] }
): MergeResult {
	let dropped = 0;
	const pages = [...site.pages];
	for (const page of imported.pages) {
		const index = pages.findIndex((item) => item.slug === page.slug);
		if (index >= 0) pages[index] = { ...page, id: pages[index].id };
		else if (pages.length < maxPages) pages.push(page);
		else dropped += 1;
	}
	const composites = [...site.composites];
	for (const composite of imported.composites) {
		const index = composites.findIndex((item) => item.name === composite.name);
		if (index >= 0) composites[index] = { ...composite, id: composites[index].id };
		else if (composites.length < maxCompositeCount) composites.push(composite);
		else dropped += 1;
	}
	return { site: { pages, composites }, dropped };
}
