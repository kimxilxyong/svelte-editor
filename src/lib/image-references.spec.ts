/**
 * @fileoverview Tests exact image URL reference detection and rewriting in editor documents.
 */
import { describe, expect, it } from 'vitest';
import type { BuilderBlock, EditorSite } from './editor.js';
import { findImageUses, replaceImageReferences } from './image-references.js';

const block = (partial: Partial<BuilderBlock>): BuilderBlock => ({
	id: 'one',
	kind: 'widget-image',
	title: 'image',
	body: '',
	action: '',
	theme: 'light',
	positioned: true,
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	value: '',
	checked: false,
	level: 0,
	href: '',
	newTab: false,
	...partial
});

describe('image references', () => {
	it('finds known URLs without replacing unrelated prose or partial values', () => {
		const url = 'https://example.com/image.svg';
		const original: EditorSite = {
			pages: [
				{
					id: 'page',
					name: 'Home',
					slug: 'home',
					width: 800,
					height: 600,
					blocks: [
						block({ id: 'image', action: url, body: `See ${url}` }),
						block({ id: 'link', kind: 'widget-link', href: url }),
						block({
							id: 'nav',
							kind: 'widget-navbar',
							action: '',
							items: `One | ${url} | extra\r\nTwo | ${url}/other`
						}),
						block({
							id: 'custom',
							kind: 'custom:Example',
							customProps: { imageUrl: url, text: `${url}/other` }
						})
					]
				}
			],
			composites: []
		};
		expect(findImageUses(original, url).map((use) => use.blockId)).toEqual([
			'image',
			'link',
			'nav',
			'custom'
		]);
		const changed = replaceImageReferences(original, url, 'https://new.example/icon.svg');
		expect(changed.pages[0].blocks[0].action).toBe('https://new.example/icon.svg');
		expect(changed.pages[0].blocks[0].body).toBe(`See ${url}`);
		expect(changed.pages[0].blocks[2].items).toBe(
			`One | https://new.example/icon.svg | extra\r\nTwo | ${url}/other`
		);
		expect(changed.pages[0].blocks[3].customProps).toEqual({
			imageUrl: 'https://new.example/icon.svg',
			text: `${url}/other`
		});
		expect(original.pages[0].blocks[0].action).toBe(url);
	});
});
