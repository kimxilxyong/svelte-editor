/**
 * @fileoverview Visual coverage for the inspector's Foreground / Background colour pickers and the
 * theme page's background picker. The pickers default to the site theme's colours, a custom colour
 * is applied to the rendered block (including text that hard-codes its own colour) and "Theme"
 * resets it.
 */
import { expect, test, type Page } from '@playwright/test';

async function addWidget(page: Page, label: RegExp): Promise<void> {
	await page.locator('[role=tab]').filter({ hasText: 'Widgets' }).first().click();
	await page.locator('.palette-item').filter({ hasText: label }).first().click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Add .* to canvas/ }).click();
}

test('inspector colour pickers default to the theme and recolour the block', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: 'Clear page' }).click();
	await addWidget(page, /Heading/);

	await expect(page.getByRole('group', { name: 'Theme' })).toHaveCount(0);
	const foreground = page.getByLabel('Foreground', { exact: true });
	const background = page.getByLabel('Background', { exact: true });
	await expect(foreground).toHaveValue('#1f2937');
	await expect(background).toHaveValue('#ffffff');
	const reset = page.getByRole('button', { name: 'Reset foreground to the site theme' });
	await expect(reset).toBeDisabled();

	const block = page.locator('article.canvas-block.widget-heading');
	const heading = block.locator('h2');
	await background.fill('#112233');
	await foreground.fill('#ffeeaa');
	await expect(block).toHaveCSS('background-color', 'rgb(17, 34, 51)');
	await expect(heading).toHaveCSS('color', 'rgb(255, 238, 170)');
	await expect(reset).toBeEnabled();
	await expect(block).toHaveScreenshot('block-colors-custom.png', { maxDiffPixelRatio: 0.02 });

	await page.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(page.locator('.page-canvas.preview article.widget-heading')).toHaveCSS(
		'background-color',
		'rgb(17, 34, 51)'
	);
	await page.getByRole('button', { name: 'Back to editor' }).click();

	await block.click({ position: { x: 5, y: 5 } });
	await reset.click();
	await page.getByRole('button', { name: 'Reset background to the site theme' }).click();
	await expect(foreground).toHaveValue('#1f2937');
	await expect(background).toHaveValue('#ffffff');
	await expect(block).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('theme page background picker recolours the preview and can return to automatic', async ({
	page
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/theme');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });

	const preview = page.locator('.preview');
	await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await page.getByLabel('Background colour').fill('#101820');
	await expect(preview).toHaveCSS('background-color', 'rgb(16, 24, 32)');
	// A dark custom background switches the text to the light colour automatically.
	await expect(preview).toHaveCSS('color', 'rgb(243, 244, 246)');
	await expect(preview).toHaveScreenshot('theme-background-custom.png', {
		maxDiffPixelRatio: 0.02
	});

	await page.getByRole('button', { name: 'Automatic' }).click();
	await page.getByLabel('Foreground colour').fill('#ff0000');
	await expect(preview).toHaveCSS('color', 'rgb(255, 0, 0)');
	await page.getByRole('button', { name: 'Automatic' }).click();
	await expect(preview).toHaveCSS('color', 'rgb(31, 41, 55)');
	await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
