/**
 * @fileoverview Tests for the managed images model, prepopulated SVG Repo Isometric 3D icons,
 * database CRUD (`project-store.ts`) and server-side image file storage (`image-files.ts`).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	extractUrlLastPathElement,
	imageCategories,
	imageCategoryLabel,
	imagePathElement,
	isValidImageCategory,
	isValidImageUrl,
	listImagePathElements,
	normalizeImageName,
	prepopulatedImages
} from './images.js';
import { ensureSchema } from './server/database/schema.js';
import { openSqliteClient } from './server/database/sqlite-client.js';
import {
	readLocalImageFile,
	removeStoredImageFile,
	storeImageFile,
	storeInlineImage,
	validateSvgContent
} from './server/image-files.js';
import {
	crawlWebPageForSvgs,
	extractSvgsFromContent,
	importCrawledSvgs
} from './server/svg-crawler.js';
import {
	createManagedImage,
	deleteManagedImage,
	listImages,
	restorePrepopulatedImages,
	updateManagedImage
} from './server/project-store.js';

describe('managed images model & prepopulated SVG Repo icons', () => {
	it('prepopulates all 50 Isometric 3D icons plus static icons with valid categories and files on disk', async () => {
		expect(prepopulatedImages.length).toBeGreaterThanOrEqual(50);
		const isometricSeeds = prepopulatedImages.filter((img) =>
			img.url.startsWith('/images/isometric/')
		);
		expect(isometricSeeds).toHaveLength(50);

		for (const seed of prepopulatedImages) {
			expect(normalizeImageName(seed.name)).toBe(seed.name);
			expect(isValidImageCategory(seed.category)).toBe(true);
			expect(isValidImageUrl(seed.url)).toBe(true);
			const file = await readLocalImageFile(seed.url);
			expect(file, `Missing on-disk file for ${seed.url}`).not.toBeNull();
			expect(file?.contentType).toBe('image/svg+xml');
		}
	});

	it('validates image names, URLs and predefined categories', () => {
		expect(normalizeImageName('  Cloud   Icon ')).toBe('Cloud Icon');
		expect(normalizeImageName('   ')).toBeNull();
		expect(isValidImageCategory('navigation')).toBe(true);
		expect(isValidImageCategory('unknown')).toBe(false);
		expect(imageCategoryLabel('commerce')).toBe('Commerce & Rewards');
		expect(imageCategories.length).toBeGreaterThanOrEqual(7);

		expect(isValidImageUrl('/images/isometric/menu.svg')).toBe(true);
		expect(isValidImageUrl('https://example.com/icon.svg')).toBe(true);
		expect(isValidImageUrl('data:image/svg+xml;utf8,<svg></svg>')).toBe(true);
		expect(isValidImageUrl('//evil.example.com/a.svg')).toBe(false);
		expect(isValidImageUrl('javascript:alert(1)')).toBe(false);

		expect(
			extractUrlLastPathElement('https://www.svgrepo.com/collection/solar-duotone-icons/')
		).toBe('solar-duotone-icons');
		expect(extractUrlLastPathElement('https://example.com/assets/isometric')).toBe('isometric');
		expect(imagePathElement('/images/isometric/menu.svg')).toBe('isometric');
		expect(imagePathElement('/images/solar/sun.svg')).toBe('solar');
		expect(listImagePathElements(prepopulatedImages)[0]).toBe('isometric');
	});
});

describe('managed images persistence', () => {
	it('seeds prepopulated images, creates, updates, deletes and restores defaults', async () => {
		const db = openSqliteClient(':memory:');
		await ensureSchema(db);

		const initial = await listImages(db);
		expect(initial.length).toBe(prepopulatedImages.length);

		const created = await createManagedImage(db, {
			name: 'Custom Badge',
			url: '/images/custom/badge.svg',
			category: 'custom'
		});
		expect(created).toMatchObject({
			name: 'Custom Badge',
			url: '/images/custom/badge.svg',
			category: 'custom',
			builtIn: false
		});

		const updated = await updateManagedImage(db, created.id, {
			name: 'Renamed Badge',
			category: 'commerce'
		});
		expect(updated.name).toBe('Renamed Badge');
		expect(updated.category).toBe('commerce');

		// Delete a prepopulated icon and verify it stays deleted until restorePrepopulatedImages.
		const firstBuiltIn = initial[0];
		await deleteManagedImage(db, firstBuiltIn.id);
		const afterDelete = await listImages(db);
		expect(afterDelete.some((item) => item.id === firstBuiltIn.id)).toBe(false);

		const restored = await restorePrepopulatedImages(db);
		expect(restored.some((item) => item.id === firstBuiltIn.id)).toBe(true);

		await db.close?.();
	});
});

describe('server image file storage', () => {
	let tempDir = '';

	afterEach(async () => {
		delete process.env.IMAGES_DIR;
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = '';
		}
	});

	it('stores uploaded and inline SVG files and rejects unsafe SVG scripts', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'svelte-editor-images-'));
		process.env.IMAGES_DIR = tempDir;

		const url = await storeInlineImage({
			name: 'Star Icon',
			category: 'custom',
			content:
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
		});
		expect(url).toBe('/images/custom/star-icon.svg');

		const readBack = await readLocalImageFile(url);
		expect(readBack?.contentType).toBe('image/svg+xml');

		await removeStoredImageFile(url);
		expect(await readLocalImageFile(url)).toBeNull();

		expect(() => validateSvgContent('<svg><script>alert(1)</script></svg>')).toThrow();
		await expect(
			storeImageFile({
				filename: 'bad.exe',
				category: 'custom',
				bytes: new Uint8Array([1, 2, 3])
			})
		).rejects.toThrow(/Unsupported image format/);
	});

	it('crawls web pages for SVGs (preview) and imports only the selected subset into static/images/<folder>/', async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'svelte-editor-crawl-'));
		process.env.IMAGES_DIR = tempDir;

		const html = `
			<html><body>
				<img src="https://cdn.example.com/icons/rocket.svg" alt="Rocket Launch SVG Icon" />
				<a href="/svg/530481/menu">Menu</a>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-label="Sparkle Star">
					<path d="M50 5 L62 38 L95 50 L62 62 L50 95 L38 62 L5 50 L38 38 Z" fill="#6b5ce7" />
				</svg>
			</body></html>
		`;
		const extracted = extractSvgsFromContent(
			html,
			new URL('https://example.com/collections/space-pack/')
		);
		expect(extracted).toHaveLength(3);
		expect(extracted.map((c) => c.name)).toEqual(['Rocket Launch', 'Menu', 'Sparkle Star']);

		const fakeFetch: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith('.svg')) {
				return new Response(
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>',
					{ status: 200, headers: { 'content-type': 'image/svg+xml' } }
				);
			}
			return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
		};

		const preview = await crawlWebPageForSvgs(
			'https://example.com/collections/space-pack/',
			fakeFetch
		);
		expect(preview.folder).toBe('space-pack');
		expect(preview.candidates).toHaveLength(3);

		// Simulate user cancelling/deselecting the middle SVG ("Menu") and importing only 2:
		const db = openSqliteClient(':memory:');
		await ensureSchema(db);
		const imported = await importCrawledSvgs(db, {
			folder: preview.folder,
			category: 'media',
			items: [preview.candidates[0], preview.candidates[2]],
			fetchFn: fakeFetch
		});
		expect(imported).toHaveLength(2);
		expect(imported[0].url).toBe('/images/space-pack/rocket-launch.svg');
		expect(imported[1].url).toBe('/images/space-pack/sparkle-star.svg');
		expect(imagePathElement(imported[0].url)).toBe('space-pack');
		await db.close?.();
	});
});
