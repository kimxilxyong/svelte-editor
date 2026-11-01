/**
 * @fileoverview Browser-level visual coverage for the Align To inspector and resolved block layout.
 *
 * The assertions inspect the actual rendered article geometry and compare the composite canvas
 * screenshot, covering inspector interaction, repeated side docking, Fill uniqueness and page-mode
 * top alignment.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

async function addButton(page: Page): Promise<void> {
	const button = page
		.locator('.palette-item')
		.filter({ hasText: /Button/ })
		.first();
	await expect(button).toBeVisible();
	await button.click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Add .* to canvas/ }).click();
}

async function setWidth(page: Page, width: number): Promise<void> {
	const field = page.getByLabel('Width (px)');
	await field.fill(String(width));
	await field.press('Tab');
	await expect(field).toHaveValue(String(width));
}

async function articleGeometry(article: Locator, canvas: Locator) {
	const [item, bounds, border] = await Promise.all([
		article.boundingBox(),
		canvas.boundingBox(),
		canvas.evaluate((element) => ({
			left: (element as HTMLElement).clientLeft,
			top: (element as HTMLElement).clientTop
		}))
	]);
	if (!item || !bounds) throw new Error('The rendered block or canvas is not visible.');
	return {
		x: Math.round(item.x - bounds.x - border.left),
		y: Math.round(item.y - bounds.y - border.top),
		width: Math.round(item.width),
		height: Math.round(item.height)
	};
}

test('composite widgets stack at edges and Fill uses the remaining canvas', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/composites');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });

	page.once('dialog', (dialog) => dialog.accept('AlignVisual'));
	await page.getByRole('button', { name: 'New', exact: true }).click();
	const canvas = page.locator('.page-canvas');
	await expect(canvas.locator('article')).toHaveCount(0);

	await addButton(page);
	const first = canvas.locator('article.canvas-block.widget-button').nth(0);
	await setWidth(page, 160);
	await page.getByLabel('Align To').selectOption('left');

	await addButton(page);
	const second = canvas.locator('article.canvas-block.widget-button').nth(1);
	await setWidth(page, 80);
	await page.getByLabel('Align To').selectOption('left');

	await addButton(page);
	const fill = canvas.locator('article.canvas-block.widget-button').nth(2);
	await page.getByLabel('Align To').selectOption('fill');

	await page.getByRole('button', { name: 'Duplicate selected block' }).click();
	const free = canvas.locator('article.canvas-block.widget-button').nth(3);
	await expect(page.getByLabel('Align To')).toHaveValue('none');
	await expect(page.getByLabel('Align To').locator('option[value="fill"]')).toBeDisabled();
	await page.getByLabel('Align To').selectOption('none');
	await page.getByLabel('Left (px)').fill('32');
	await page.getByLabel('Left (px)').press('Tab');
	await page.getByLabel('Top (px)').fill('48');
	await page.getByLabel('Top (px)').press('Tab');

	await expect
		.poll(() => articleGeometry(first, canvas))
		.toEqual({
			x: 0,
			y: 0,
			width: 160,
			height: 360
		});
	await expect
		.poll(() => articleGeometry(second, canvas))
		.toEqual({
			x: 160,
			y: 0,
			width: 80,
			height: 360
		});
	await expect
		.poll(() => articleGeometry(fill, canvas))
		.toEqual({
			x: 240,
			y: 0,
			width: 720,
			height: 360
		});
	await expect
		.poll(() => articleGeometry(free, canvas))
		.toEqual({
			x: 32,
			y: 48,
			width: 120,
			height: 36
		});
	await expect(canvas).toHaveScreenshot('align-to-composite.png', {
		animations: 'disabled'
	});
});

test('page widgets align within the page’s declared width', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	const canvas = page.locator('.page-canvas');

	await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
	await addButton(page);
	const top = canvas.locator('article.canvas-block.widget-button').last();
	await page.getByLabel('Align To').selectOption('top');

	const declaredWidth = await canvas.evaluate((element) =>
		Number.parseFloat((element as HTMLElement).style.width)
	);
	await expect
		.poll(() => articleGeometry(top, canvas))
		.toEqual({
			x: 0,
			y: 0,
			width: declaredWidth,
			height: 36
		});
	await expect(page.getByLabel('Width (px)')).toBeDisabled();
	await expect(page.getByLabel('Height (px)')).toBeEnabled();
});
