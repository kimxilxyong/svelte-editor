/**
 * @fileoverview One-time migration of stored sites from the "sections" era to composite components.
 *
 * Earlier versions saved six fixed layout blocks with the kinds `hero`, `text`, `button`,
 * `features`, `image` and `quote` and had no `composites` array. This module rewrites such raw
 * JSON in place of a compatibility layer: the legacy kinds become `composite:<SeedName>` and the
 * matching seed composites (see `composite-seeds.ts`) are added to the site. The result is then
 * persisted by `getSavedSite`, so the migration runs only once per database.
 *
 * Note: legacy section blocks carried their own title/body/action text. Composites have no
 * per-instance text, so instances show the seed composite's content afterwards.
 */

import { legacyKindToComposite, seedComposites } from './composite-seeds.js';

/** Result of {@link migrateSiteData}. */
export type MigrationResult = {
	/** The (possibly rewritten) site JSON; the input object is never mutated. */
	data: unknown;
	/** `true` when anything was rewritten and the caller should persist `data`. */
	changed: boolean;
};

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rewrites legacy kinds in one block array; returns the new array and the referenced seeds. */
function migrateBlocks(blocks: unknown, used: Set<string>): { blocks: unknown; changed: boolean } {
	if (!Array.isArray(blocks)) return { blocks, changed: false };
	let changed = false;
	const next = blocks.map((block) => {
		if (!isRecord(block) || typeof block.kind !== 'string') return block;
		const replacement = legacyKindToComposite(block.kind);
		if (!replacement) return block;
		changed = true;
		used.add(replacement.slice(10));
		return { ...block, kind: replacement };
	});
	return { blocks: next, changed };
}

/**
 * Migrates raw stored site JSON to the composite model.
 *
 * @param raw - Parsed JSON of a saved site (`{ pages: [...] }`); other shapes pass through.
 * @returns The migrated data and whether it differs from the input.
 * @example
 * migrateSiteData({ pages: [{ blocks: [{ kind: 'hero' }] }] }).changed; // true
 */
export function migrateSiteData(raw: unknown): MigrationResult {
	if (!isRecord(raw) || !Array.isArray(raw.pages)) return { data: raw, changed: false };

	const used = new Set<string>();
	let changed = false;
	const pages = raw.pages.map((page) => {
		if (!isRecord(page)) return page;
		const result = migrateBlocks(page.blocks, used);
		changed ||= result.changed;
		return result.changed ? { ...page, blocks: result.blocks } : page;
	});

	const hadComposites = Array.isArray(raw.composites);
	const composites: unknown[] = hadComposites ? [...(raw.composites as unknown[])] : [];
	if (!hadComposites) changed = true;

	const existing = new Set(
		composites.filter(isRecord).map((composite) => composite.name as string)
	);
	// A site without any composites gets all starters as examples; otherwise only referenced ones.
	for (const seed of seedComposites()) {
		if ((!hadComposites || used.has(seed.name)) && !existing.has(seed.name)) {
			composites.push(seed);
			changed = true;
		}
	}

	if (!changed) return { data: raw, changed: false };
	return { data: { ...raw, pages, composites }, changed: true };
}
