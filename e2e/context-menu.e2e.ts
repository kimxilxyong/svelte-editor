/**
 * @fileoverview End-to-end coverage of the app-wide right-click menu on the Pages overview
 * and in the visual editor.
 */
import { expect, test } from '@playwright/test';

test('page list and row menus open, close and act', async ({ page }) => {
	// A fresh database has no pages: save the editor's default page first.
	await page.goto('/editor');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved to the database');
	await page.goto('/');
	const rows = page.locator('.page-item');
	const menu = page.getByRole('menu');
	await expect(rows.first()).toBeVisible();
	const before = await rows.count();

	// List menu: Add creates a page.
	await page.getByRole('complementary', { name: 'Pages' }).click({
		button: 'right',
		position: { x: 5, y: 5 }
	});
	await menu.getByRole('menuitem', { name: /^Add page/ }).click();
	await expect(rows).toHaveCount(before + 1);

	// Row menu: opens, Escape closes it.
	await rows.first().click({ button: 'right' });
	await expect(menu.getByRole('menuitem', { name: /^Edit/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();

	// Row menu: Edit navigates to the editor.
	// The unsaved new page triggers the leave-page confirmation.
	page.once('dialog', (dialog) => dialog.accept());
	await rows.first().click({ button: 'right' });
	await menu.getByRole('menuitem', { name: /^Edit/ }).click();
	await expect(page).toHaveURL(/\/editor\?page=/);
});

test('editor palette and block menus work; text fields keep the native menu', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto('/editor');
	const menu = page.getByRole('menu');
	const blocks = page.locator('.page-canvas article');
	const before = await blocks.count();

	await page.getByRole('tab', { name: 'Widgets' }).click();
	await page
		.locator('.palette-item')
		.filter({ hasText: /Button/ })
		.first()
		.click({
			button: 'right'
		});
	await menu.getByRole('menuitem', { name: /^Add .* to canvas/ }).click();
	await expect(blocks).toHaveCount(before + 1);

	await blocks.last().click({ button: 'right' });
	await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
	await expect(blocks).toHaveCount(before + 2);

	const input = page.getByLabel('Button label');
	await input.click({ button: 'right' });
	await expect(menu).toBeHidden();
});
