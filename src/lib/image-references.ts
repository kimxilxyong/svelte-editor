/**
 * @fileoverview Finds and rewrites image URLs in saved page and composite blocks.
 *
 * The editor stores URLs as ordinary strings rather than foreign keys. This module recognizes
 * image widget sources, link destinations, navigation-list destinations and custom string props.
 * It deliberately does not search arbitrary source files or replace substrings in prose.
 */

import type { BuilderBlock, EditorSite } from './editor.js';

const linkListKinds = new Set([
	'widget-breadcrumb',
	'widget-navbar',
	'widget-footer',
	'widget-sidebar',
	'widget-dropdown'
]);

/** A saved document and block containing an exact image URL reference. */
export interface ImageUse {
	/** Page or composite containing the reference. */
	document: string;
	/** Whether the document is a page or a composite. */
	kind: 'page' | 'composite';
	/** Identifier of the block that contains the reference. */
	blockId: string;
}

/**
 * Rewrites only the URL half of a navigation entry, preserving its label and whitespace.
 */
function replaceListUrls(items: string, before: string, after: string): string {
	return items
		.split('\n')
		.map((line) => {
			const match = /^([^|]*\|)([ \t]*)([^|\r]*?)([ \t]*)(\|[^\r]*)?(\r?)$/.exec(line);
			if (!match || match[3] !== before) return line;
			return `${match[1]}${match[2]}${after}${match[4]}${match[5] ?? ''}${match[6]}`;
		})
		.join('\n');
}

/** Returns a copy of the block with any recognized references changed. */
function rewriteBlock(block: BuilderBlock, before: string, after: string): BuilderBlock {
	const result = { ...block };
	if (result.kind === 'widget-image' && result.action === before) result.action = after;
	if (result.href === before) result.href = after;
	if (result.items && linkListKinds.has(result.kind)) {
		result.items = replaceListUrls(result.items, before, after);
	}
	if (result.customProps) {
		result.customProps = Object.fromEntries(
			Object.entries(result.customProps).map(([key, value]) => [
				key,
				typeof value === 'string' && value === before ? after : value
			])
		);
	}
	return result;
}

/**
 * Lists saved blocks that refer to an image URL.
 *
 * @param site - Saved pages and composite definitions of one project.
 * @param url - Exact URL stored by the image library.
 * @returns One entry per referencing block.
 * @example
 * findImageUses({ pages: [], composites: [] }, '/media/icon.svg'); // []
 */
export function findImageUses(site: EditorSite, url: string): ImageUse[] {
	const uses: ImageUse[] = [];
	for (const [kind, documents] of [
		['page', site.pages],
		['composite', site.composites]
	] as const) {
		for (const document of documents) {
			for (const block of document.blocks) {
				if (JSON.stringify(rewriteBlock(block, url, '')) !== JSON.stringify(block)) {
					uses.push({ kind, document: document.name, blockId: block.id });
				}
			}
		}
	}
	return uses;
}

/**
 * Replaces exact image references without mutating the caller's site.
 *
 * @param site - Saved site.
 * @param before - Existing image URL.
 * @param after - New image URL.
 * @returns The updated site; unrelated block fields are preserved.
 */
export function replaceImageReferences(
	site: EditorSite,
	before: string,
	after: string
): EditorSite {
	return {
		pages: site.pages.map((page) => ({
			...page,
			blocks: page.blocks.map((block) => rewriteBlock(block, before, after))
		})),
		composites: site.composites.map((composite) => ({
			...composite,
			blocks: composite.blocks.map((block) => rewriteBlock(block, before, after))
		}))
	};
}
