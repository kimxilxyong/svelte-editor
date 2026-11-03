/**
 * @fileoverview Exercises the project-scoped image API, managed serving and stale-save protection.
 */
import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BuilderBlock, EditorSite } from '../src/lib/editor.js';

test('image imports, references, revisions and project isolation', async ({ page }) => {
	const created = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Image test ${Date.now()}` }
	});
	expect(created.ok()).toBe(true);
	const { project } = (await created.json()) as { project: { id: string } };
	const expectedProjectId = project.id;

	const library = await page.request.get('/images/api');
	const { images } = (await library.json()) as { images: { id: string }[] };
	expect(images).toHaveLength(50);
	expect(images.some((image) => image.id === 'svgrepo-530481')).toBe(true);

	const uploaded = await page.request.post('/images/api', {
		headers: { origin: new URL(library.url()).origin },
		multipart: {
			action: 'upload',
			expectedProjectId,
			name: 'Uploaded icon',
			category: 'Icons',
			file: {
				name: 'icon.svg',
				mimeType: 'image/svg+xml',
				buffer: Buffer.from(
					'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'
				)
			}
		}
	});
	expect(uploaded.ok(), await uploaded.text()).toBe(true);
	const { image } = (await uploaded.json()) as { image: { id: string; url: string } };
	const asset = await page.request.get(image.url);
	expect(asset.ok()).toBe(true);
	expect(asset.headers()['content-type']).toContain('image/svg+xml');
	expect(asset.headers()['cache-control']).toContain('private');

	const block: BuilderBlock = {
		id: 'image-block',
		kind: 'widget-image',
		title: 'Icon',
		body: '',
		action: image.url,
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
		newTab: false
	};
	const site: EditorSite = {
		pages: [{ id: 'home', name: 'Home', slug: 'home', width: 800, height: 600, blocks: [block] }],
		composites: []
	};
	const snapshot = await (await page.request.get('/editor/api')).json();
	const saved = await page.request.post('/editor/api', {
		data: { action: 'save', site, revision: snapshot.revision, expectedProjectId }
	});
	expect(saved.ok()).toBe(true);
	const deletion = await page.request.post('/images/api', {
		data: { action: 'delete', id: image.id, expectedProjectId }
	});
	expect(deletion.status()).toBe(409);

	const stale = await (await page.request.get('/editor/api')).json();
	const added = await page.request.post('/images/api', {
		data: {
			action: 'create',
			expectedProjectId,
			name: 'External',
			category: 'Photos',
			url: 'https://example.com/image.png'
		}
	});
	expect(added.ok()).toBe(true);
	const linkedImage = (await added.json()).image as { id: string; url: string };
	const staleSave = await page.request.post('/editor/api', {
		data: { action: 'save', site: stale.site, revision: stale.revision, expectedProjectId }
	});
	expect(staleSave.status()).toBe(409);

	const latest = await (await page.request.get('/editor/api')).json();
	const linkedSite = latest.site as EditorSite;
	linkedSite.pages[0].blocks.push({
		...block,
		id: 'link-block',
		kind: 'widget-link',
		action: '',
		href: linkedImage.url
	});
	expect(
		(
			await page.request.post('/editor/api', {
				data: { action: 'save', site: linkedSite, revision: latest.revision, expectedProjectId }
			})
		).ok()
	).toBe(true);
	const newUrl = 'https://example.com/updated-image.png';
	expect(
		(
			await page.request.post('/images/api', {
				data: {
					action: 'update',
					expectedProjectId,
					id: linkedImage.id,
					name: 'External',
					category: 'Photos',
					url: newUrl
				}
			})
		).ok()
	).toBe(true);
	const updatedSite = (await (await page.request.get('/editor/api')).json()).site as EditorSite;
	expect(updatedSite.pages[0].blocks.find((item) => item.id === 'link-block')?.href).toBe(newUrl);
	expect(
		(
			await page.request.post('/images/api', {
				data: { action: 'delete', expectedProjectId, id: linkedImage.id }
			})
		).status()
	).toBe(409);

	const second = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Other image test ${Date.now()}` }
	});
	expect(second.ok()).toBe(true);
	const secondProject = (await second.json()).project as { id: string };
	expect((await page.request.get(image.url)).status()).toBe(404);
	expect(
		(
			await page.request.post('/images/api', {
				data: { action: 'delete', id: image.id, expectedProjectId }
			})
		).status()
	).toBe(409);
	await page.request.post('/projects/api', { data: { action: 'delete', id: secondProject.id } });
	await page.request.post('/projects/api', { data: { action: 'delete', id: project.id } });
});

test('image management page creates, edits and deletes a link', async ({ page }, testInfo) => {
	const created = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Image UI ${Date.now()}` }
	});
	expect(created.ok()).toBe(true);
	const { project } = (await created.json()) as { project: { id: string } };
	await page.route('https://www.svgrepo.com/**', (route) => route.abort());
	await page.route('https://example.com/*.svg', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="purple"/></svg>'
		})
	);
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/images');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await expect(page.getByRole('heading', { name: 'Image library' })).toBeVisible();
	await page.getByRole('button', { name: 'Add link' }).click();
	const form = page.locator('section[aria-label="Image details"] form');
	await form.getByLabel('Name', { exact: true }).fill('Sample icon');
	await form.getByLabel('Image URL').fill('https://example.com/icon.svg');
	await form.getByLabel('Category').selectOption('Icons');
	await form.getByRole('button', { name: 'Add image' }).click();
	await expect(page.getByRole('heading', { name: 'Sample icon' })).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'Image added' })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('images-desktop.png') });

	await form.getByLabel('Name', { exact: true }).fill('Renamed icon');
	await form.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('heading', { name: 'Renamed icon' })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: testInfo.outputPath('images-mobile.png') });
	const overflow = await page.evaluate(() => ({
		width: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
		elements: [...document.querySelectorAll<HTMLElement>('body *')]
			.filter(
				(element) =>
					element.getBoundingClientRect().right > document.documentElement.clientWidth + 1
			)
			.slice(0, 10)
			.map((element) => `${element.tagName}.${element.className}`)
	}));
	expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);

	await page.getByRole('button', { name: 'Delete image', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm delete' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Image deleted' })).toBeVisible();
	await page.request.post('/projects/api', { data: { action: 'delete', id: project.id } });
});

test('editor image and link fields select project-library URLs', async ({ page }) => {
	const created = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Image picker ${Date.now()}` }
	});
	expect(created.ok()).toBe(true);
	const { project } = (await created.json()) as { project: { id: string } };
	const localImage = await page.request.post('/images/api', {
		data: {
			action: 'create',
			expectedProjectId: project.id,
			name: 'Local asset',
			url: '/sample-preview.svg',
			category: 'Icons'
		}
	});
	expect(localImage.ok()).toBe(true);
	await page.route('https://www.svgrepo.com/**', (route) => route.abort());
	await page.route('**/sample-preview.svg', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'
		})
	);
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Add first page' }).click();
	await page.getByRole('tab', { name: 'Widgets' }).click();

	async function addWidget(detail: string) {
		await page
			.locator('.palette-item')
			.filter({ hasText: detail })
			.first()
			.click({ button: 'right' });
		await page.getByRole('menuitem', { name: /^Add .* to canvas/ }).click();
	}

	await addWidget('A picture with caption');
	const imagePicker = page
		.locator('details.image-picker')
		.filter({ hasText: 'Choose image for image URL' });
	await imagePicker.locator('summary').click();
	await imagePicker.getByRole('button', { name: /^Menu Icons$/ }).click();
	await expect(page.getByLabel('Image URL', { exact: true })).toHaveValue(
		'https://www.svgrepo.com/show/530481/menu.svg'
	);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');

	await addWidget('Go to a page or website');
	const linkPicker = page
		.locator('details.image-picker')
		.filter({ hasText: 'Choose image for link address' });
	await linkPicker.locator('summary').click();
	await linkPicker.getByRole('button', { name: /^Folder Icons$/ }).click();
	await expect(page.getByLabel('Link address', { exact: true })).toHaveValue(
		'https://www.svgrepo.com/show/530518/folder.svg'
	);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');

	await linkPicker.locator('summary').click();
	await linkPicker.getByRole('button', { name: /^Local asset Icons$/ }).click();
	await expect(page.getByLabel('Link address', { exact: true })).toHaveValue('/sample-preview.svg');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');
	await page.getByRole('button', { name: 'Preview', exact: true }).click();
	await page.locator('.page-canvas.preview a[href="/sample-preview.svg"]').click();
	await expect(page).toHaveURL(/\/sample-preview\.svg$/);
	await page.request.post('/projects/api', { data: { action: 'delete', id: project.id } });
});

test('changing an image URL rejects a stale editor save without losing the draft', async ({
	page
}) => {
	const created = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Image conflict ${Date.now()}` }
	});
	expect(created.ok()).toBe(true);
	const { project } = (await created.json()) as { project: { id: string } };
	await page.route('https://www.svgrepo.com/**', (route) => route.abort());
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Add first page' }).click();
	await page.getByRole('tab', { name: 'Widgets' }).click();
	await page
		.locator('.palette-item')
		.filter({ hasText: 'A picture with caption' })
		.first()
		.click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Add Image to canvas/ }).click();
	const picker = page
		.locator('details.image-picker')
		.filter({ hasText: 'Choose image for image URL' });
	await picker.locator('summary').click();
	await picker.getByRole('button', { name: /^Menu Icons$/ }).click();
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');

	const alt = page.getByLabel('Alt text', { exact: true });
	await alt.fill('Unsaved draft text');
	const update = await page.request.post('/images/api', {
		data: {
			action: 'update',
			expectedProjectId: project.id,
			id: 'svgrepo-530481',
			name: 'Menu',
			category: 'Icons',
			url: 'https://example.com/updated-menu.svg'
		}
	});
	expect(update.ok()).toBe(true);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('draft is retained');
	await expect(alt).toHaveValue('Unsaved draft text');
	const snapshot = await (await page.request.get('/editor/api')).json();
	expect(snapshot.site.pages[0].blocks[0].action).toBe('https://example.com/updated-menu.svg');
	await page.request.post('/projects/api', { data: { action: 'delete', id: project.id } });
});

test('switching projects confirms before discarding a Pages draft', async ({ page }) => {
	const suffix = Date.now();
	const firstName = `First project ${suffix}`;
	const first = await page.request.post('/projects/api', {
		data: { action: 'create', name: firstName }
	});
	const second = await page.request.post('/projects/api', {
		data: { action: 'create', name: `Second project ${suffix}` }
	});
	expect(first.ok() && second.ok()).toBe(true);
	const firstProject = (await first.json()).project as { id: string };
	const secondProject = (await second.json()).project as { id: string };
	await page.goto('/pages');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Add first page' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Unsaved page');
	await page.locator('.project-chip summary').click();
	page.once('dialog', (dialog) => void dialog.dismiss());
	await page.getByRole('button', { name: firstName }).click();
	await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved page');
	await expect(page.locator('.project-chip summary')).toContainText('Second project');

	await page.locator('.project-chip summary').click();
	page.once('dialog', (dialog) => void dialog.accept());
	await page.getByRole('button', { name: firstName }).click();
	await expect(page.getByTestId('pages-empty')).toBeVisible();
	await expect(page.locator('.project-chip summary')).toContainText(firstName);
	await page.request.post('/projects/api', { data: { action: 'delete', id: firstProject.id } });
	await page.request.post('/projects/api', { data: { action: 'delete', id: secondProject.id } });
});

test('project export and import restore managed images and edited starters', async ({ page }) => {
	const root = await mkdtemp(path.join(tmpdir(), 'editor-images-roundtrip-'));
	let sourceId = '';
	let targetId = '';
	try {
		await mkdir(path.join(root, 'src', 'routes'), { recursive: true });
		await writeFile(path.join(root, 'package.json'), '{}');
		const source = await page.request.post('/projects/api', {
			data: { action: 'create', name: `Image export ${Date.now()}` }
		});
		expect(source.ok()).toBe(true);
		sourceId = ((await source.json()).project as { id: string }).id;
		const listed = await page.request.get('/images/api');
		expect(listed.ok()).toBe(true);
		expect(
			(
				await page.request.post('/images/api', {
					data: { action: 'delete', id: 'svgrepo-530481', expectedProjectId: sourceId }
				})
			).ok()
		).toBe(true);
		expect(
			(
				await page.request.post('/images/api', {
					data: {
						action: 'update',
						id: 'svgrepo-530482',
						name: 'Edited starter',
						category: 'Icons',
						url: 'https://example.com/edited.svg',
						expectedProjectId: sourceId
					}
				})
			).ok()
		).toBe(true);
		const upload = await page.request.post('/images/api', {
			headers: { origin: new URL(listed.url()).origin },
			multipart: {
				action: 'upload',
				expectedProjectId: sourceId,
				name: 'Managed icon',
				category: 'Icons',
				file: {
					name: 'icon.svg',
					mimeType: 'image/svg+xml',
					buffer: Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'
					)
				}
			}
		});
		expect(upload.ok(), await upload.text()).toBe(true);
		const uploaded = (await upload.json()).image as { id: string; url: string };
		const exported = await page.request.post('/editor/api/project', {
			data: { action: 'export', root, expectedProjectId: sourceId }
		});
		expect(exported.ok(), await exported.text()).toBe(true);
		expect((await exported.json()).skipped).toEqual([]);

		const target = await page.request.post('/projects/api', {
			data: { action: 'create', name: `Image import ${Date.now()}` }
		});
		expect(target.ok()).toBe(true);
		targetId = ((await target.json()).project as { id: string }).id;
		const imported = await page.request.post('/editor/api/project', {
			data: { action: 'import', root, expectedProjectId: targetId }
		});
		expect(imported.ok(), await imported.text()).toBe(true);
		expect((await imported.json()).imageCount).toBe(50);
		const images = (await (await page.request.get('/images/api')).json()).images as {
			id: string;
			name: string;
			url: string;
		}[];
		expect(images.some((image) => image.id === 'svgrepo-530481')).toBe(false);
		expect(images.find((image) => image.id === 'svgrepo-530482')).toMatchObject({
			name: 'Edited starter',
			url: 'https://example.com/edited.svg'
		});
		expect(images.some((image) => image.id === uploaded.id)).toBe(true);
		expect((await page.request.get(uploaded.url)).ok()).toBe(true);
	} finally {
		if (targetId)
			await page.request.post('/projects/api', { data: { action: 'delete', id: targetId } });
		if (sourceId)
			await page.request.post('/projects/api', { data: { action: 'delete', id: sourceId } });
		await rm(root, { recursive: true, force: true });
	}
});
