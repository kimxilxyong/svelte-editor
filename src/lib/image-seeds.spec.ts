/**
 * @fileoverview Regression tests for the linked SVG Repo starter catalog.
 */
import { describe, expect, it } from 'vitest';
import { starterImages } from './image-seeds.js';

describe('starter images', () => {
	it('contains the 50 distinct icons from the requested collection', () => {
		const images = starterImages();
		expect(images).toHaveLength(50);
		expect(new Set(images.map((image) => image.id)).size).toBe(50);
		expect(new Set(images.map((image) => image.url)).size).toBe(50);
		expect(images[0]).toMatchObject({
			name: 'Menu',
			url: 'https://www.svgrepo.com/show/530481/menu.svg',
			category: 'Icons',
			kind: 'link'
		});
		expect(images[49]).toMatchObject({
			name: 'Report',
			url: 'https://www.svgrepo.com/show/530530/report.svg'
		});
	});
});
