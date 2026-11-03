import { describe, expect, it } from 'vitest';
import type { EditorComposite, EditorPage } from './editor.js';
import { mergeImportedSite } from './site-merge.js';

const page = (id: string, slug: string, width = 800): EditorPage => ({
	id,
	name: slug,
	slug,
	width,
	height: 600,
	blocks: []
});
const composite = (id: string, name: string): EditorComposite => ({
	id,
	name,
	width: 400,
	height: 100,
	blocks: []
});

describe('mergeImportedSite', () => {
	it('adds into an empty project', () => {
		const { site, dropped } = mergeImportedSite(
			{ pages: [], composites: [] },
			{ pages: [page('x', 'home')], composites: [composite('c', 'Hero')] }
		);
		expect(site.pages).toHaveLength(1);
		expect(site.composites).toHaveLength(1);
		expect(dropped).toBe(0);
	});

	it('replaces same slug / name but keeps the existing id', () => {
		const { site } = mergeImportedSite(
			{ pages: [page('keep', 'home', 800)], composites: [composite('ck', 'Hero')] },
			{ pages: [page('new', 'home', 1200)], composites: [composite('cn', 'Hero')] }
		);
		expect(site.pages).toEqual([{ ...page('keep', 'home', 1200) }]);
		expect(site.composites[0].id).toBe('ck');
	});

	it('drops what does not fit the limits and leaves the input untouched', () => {
		const existing = {
			pages: Array.from({ length: 20 }, (_, i) => page(`p${i}`, `s${i}`)),
			composites: []
		};
		const { site, dropped } = mergeImportedSite(existing, {
			pages: [page('n', 'extra')],
			composites: []
		});
		expect(site.pages).toHaveLength(20);
		expect(dropped).toBe(1);
		expect(existing.pages).toHaveLength(20);
	});
});
