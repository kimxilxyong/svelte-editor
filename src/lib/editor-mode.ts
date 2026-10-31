/**
 * @fileoverview Typed boundary between the shared visual canvas editor and its page/composite
 * documents. It keeps both domain models intact while selecting the active documents, exposing
 * pages for link editing, and merging edited documents back into a complete site.
 */

import type { EditorComposite, EditorPage, EditorSite } from './editor.js';

/**
 * The visual editor's mode, corresponding to the domain collection it edits.
 */
export type EditorMode = 'pages' | 'composites';

/**
 * A document that can be displayed and edited by the shared canvas.
 *
 * Pages and composites share identity, dimensions, and blocks but keep their distinct persisted
 * shapes; page slugs remain page-only data.
 */
export type EditorDocument = EditorPage | EditorComposite;

/**
 * Narrows a canvas document to a site page.
 *
 * @param document - A page or composite displayed by the shared canvas.
 * @returns `true` when the document has page-only slug data.
 */
export function isEditorPage(document: EditorDocument): document is EditorPage {
	return 'slug' in document;
}

/**
 * Formats a canvas document for the document switcher.
 *
 * @param document - A page or composite displayed by the shared canvas.
 * @returns The page name and route, or just the composite name.
 */
export function editorDocumentLabel(document: EditorDocument): string {
	return isEditorPage(document) ? `${document.name} · /${document.slug}` : document.name;
}

/**
 * Returns the site documents selected for the visual editor.
 *
 * @param mode - Selects either the site's pages or its reusable composites.
 * @param site - The complete site loaded from persistence.
 * @returns The selected domain documents without converting their shapes.
 * @example
 * ```ts
 * const documents = editorDocumentsForMode('composites', site);
 * ```
 */
export function editorDocumentsForMode(mode: EditorMode, site: EditorSite): EditorDocument[] {
	return mode === 'pages' ? site.pages : site.composites;
}

/**
 * Returns the pages available as internal link targets in the active editing mode.
 *
 * @param mode - The active editor mode.
 * @param documents - The documents currently open in the canvas.
 * @param stashedPages - The unchanged site pages while composites are being edited.
 * @returns The site pages, preserving their slugs for link editing.
 * @throws {TypeError} If page mode contains a composite document.
 */
export function linkPagesForMode(
	mode: EditorMode,
	documents: EditorDocument[],
	stashedPages: EditorPage[]
): EditorPage[] {
	if (mode === 'composites') return stashedPages;

	const pages: EditorPage[] = [];
	for (const document of documents) {
		if (!isEditorPage(document)) {
			throw new TypeError('Page mode can only contain page documents.');
		}
		pages.push(document);
	}
	return pages;
}

/**
 * Merges the edited documents with the unchanged collection to produce a complete site snapshot.
 *
 * @param mode - The active editor mode.
 * @param editedDocuments - The documents currently edited on the canvas.
 * @param stashedPages - The unchanged page collection.
 * @param stashedComposites - The unchanged composite collection.
 * @returns A complete site with the edited collection and the untouched collection preserved.
 * @throws {TypeError} If the edited collection contains a document for the other mode.
 * @example
 * ```ts
 * const snapshot = mergeEditorDocuments('pages', editedPages, [], savedComposites);
 * ```
 */
export function mergeEditorDocuments(
	mode: EditorMode,
	editedDocuments: EditorDocument[],
	stashedPages: EditorPage[],
	stashedComposites: EditorComposite[]
): EditorSite {
	if (mode === 'pages') {
		const pages: EditorPage[] = [];
		for (const document of editedDocuments) {
			if (!isEditorPage(document)) {
				throw new TypeError('Page mode can only save page documents.');
			}
			pages.push(document);
		}
		return { pages, composites: [...stashedComposites] };
	}

	const composites: EditorComposite[] = [];
	for (const document of editedDocuments) {
		if (isEditorPage(document)) {
			throw new TypeError('Composite mode can only save composite documents.');
		}
		composites.push(document);
	}
	return { pages: [...stashedPages], composites };
}
