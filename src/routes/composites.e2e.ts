/**
 * @fileoverview End-to-end tests for dragging palette items (composites, widgets) onto the page
 * canvas of `/editor` and onto the composite canvas of `/composites`.
 */
import { expect, test } from '@playwright/test';

// Authentication comes from the shared `setup` project (see `e2e/auth.setup.ts`).

test('dragging a composite from the palette onto a page adds a block', async ({ page }) => {
	await page.goto('/editor');
	await page.getByRole('tab', { name: 'Composites' }).click();
	const before = await page.locator('.page-canvas .canvas-block').count();
	// Manual pointer steps: Playwright's dragTo does not reliably start a native drag for items
	// near the bottom edge of the palette.
	const item = page.getByLabel('Drag Testimonial onto the page');
	await item.scrollIntoViewIfNeeded();
	const b = (await item.boundingBox())!;
	await page.mouse.move(b.x + 20, b.y + 20);
	await page.mouse.down();
	await page.mouse.move(b.x + 60, b.y + 40, { steps: 5 });
	const t = (await page.getByRole('region', { name: 'Page canvas drop zone' }).boundingBox())!;
	await page.mouse.move(t.x + 300, t.y + 200, { steps: 10 });
	await page.mouse.up();
	await expect(page.locator('.page-canvas .canvas-block')).toHaveCount(before + 1);
});

test('dragging a widget onto a page adds a block', async ({ page }) => {
	await page.goto('/editor');
	await page.getByRole('tab', { name: 'Widgets' }).click();
	const before = await page.locator('.page-canvas .canvas-block').count();
	await page
		.getByLabel('Drag Button onto the page')
		.first()
		.dragTo(page.getByRole('region', { name: 'Page canvas drop zone' }));
	await expect(page.locator('.page-canvas .canvas-block')).toHaveCount(before + 1);
});

test('dragging a widget onto the composite canvas adds a block', async ({ page }) => {
	await page.goto('/composites');
	await page.getByRole('tab', { name: 'Widgets' }).click();
	const before = await page.locator('.page-canvas .canvas-block').count();
	await page
		.getByLabel('Drag Button onto the page')
		.first()
		.dragTo(page.getByRole('region', { name: 'Page canvas drop zone' }));
	await expect(page.locator('.page-canvas .canvas-block')).toHaveCount(before + 1);
});
