/**
 * @fileoverview Visual regression tests for the site theme's form-control options on `/theme`.
 *
 * Every input style and every built-in look is applied to the (unsaved) draft theme and the live
 * preview is compared against a baseline screenshot (`e2e/theme-looks.e2e.ts-snapshots/`). Computed
 * styles are asserted as well, so a failure explains *what* changed and not just that pixels differ.
 * Refresh baselines after an intentional change with
 * `npx playwright test e2e/theme-looks.e2e.ts --update-snapshots`.
 */
import { expect, test, type Page } from '@playwright/test';

/** Expected computed look of the first text input for each input style (size `sm`, thin border). */
const styleExpectations = {
	outlined: { top: '1px', bottom: '1px', bg: 'rgb(255, 255, 255)', radius: '6px' },
	filled: { top: '1px', bottom: '1px', bg: 'oklch(0.967 0.003 264.542)', radius: '6px' },
	underlined: { top: '0px', bottom: '1px', bg: 'rgba(0, 0, 0, 0)', radius: '0px' },
	soft: { top: '1px', bottom: '1px', bg: 'rgb(248, 247, 253)', radius: '6px' }
} as const;

async function openTheme(page: Page) {
	await page.setViewportSize({ width: 1600, height: 1400 });
	await page.goto('/theme');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	// A stable baseline: the default look (draft only, nothing is saved).
	await page.getByRole('button', { name: 'Default', exact: true }).click();
}

const input = (page: Page) => page.locator('.preview input[type="text"]').first();

for (const style of ['outlined', 'filled', 'underlined', 'soft'] as const) {
	test(`input style "${style}" renders as designed`, async ({ page }) => {
		await openTheme(page);
		await page.getByLabel('Input style').selectOption(style);
		const want = styleExpectations[style];
		await expect(input(page)).toHaveCSS('border-top-width', want.top);
		await expect(input(page)).toHaveCSS('border-bottom-width', want.bottom);
		await expect(input(page)).toHaveCSS('border-top-left-radius', want.radius);
		const bg = await input(page).evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(bg.startsWith(want.bg)).toBe(true);
		await expect(page.locator('.preview')).toHaveScreenshot(`style-${style}.png`, {
			animations: 'disabled'
		});
	});
}

for (const look of ['Default', 'Minimal', 'Enterprise', 'Soft', 'Playful']) {
	test(`look "${look}" renders consistently`, async ({ page }) => {
		await openTheme(page);
		await page.getByRole('button', { name: look, exact: true }).click();
		await expect(page.locator('.preview')).toHaveScreenshot(`look-${look.toLowerCase()}.png`, {
			animations: 'disabled'
		});
	});
}

test('size, border and focus ring options change the control', async ({ page }) => {
	await openTheme(page);
	await page.getByLabel('Input size').selectOption('lg');
	await page.getByLabel('Input border').selectOption('thick');
	await expect(input(page)).toHaveCSS('border-top-width', '4px');
	await expect(input(page)).toHaveCSS('font-size', '16px');
	await page.getByLabel('Focus ring').selectOption('secondary');
	await input(page).focus();
	await expect(input(page)).toHaveCSS('border-top-color', /./);
	await expect(page.locator('.preview')).toHaveScreenshot('size-lg-thick-focus-secondary.png', {
		animations: 'disabled'
	});
});

/**
 * Every catalog widget rendered under each look. Themed controls must follow the look; a widget
 * that silently ignores the theme (a Flowbite component reading a different theme slot) shows up
 * as a screenshot diff. Also fails on any uncaught page error while rendering the full set.
 */
for (const look of ['Default', 'Minimal', 'Enterprise', 'Soft', 'Playful']) {
	test(`all widgets under look "${look}"`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await openTheme(page);
		await page.getByRole('button', { name: look, exact: true }).click();
		await page.getByLabel('Show all widgets').check();
		await expect(page.locator('.preview-item').nth(50)).toBeAttached();
		await expect(page.locator('.preview')).toHaveScreenshot(`all-${look.toLowerCase()}.png`, {
			animations: 'disabled',
			maxDiffPixelRatio: 0.001
		});
		expect(errors).toEqual([]);
	});
}

test('all widgets in dark mode', async ({ page }) => {
	await openTheme(page);
	await page.getByRole('button', { name: 'Soft', exact: true }).click();
	await page.getByLabel('Dark mode').check();
	await page.getByLabel('Show all widgets').check();
	await expect(page.locator('.preview-item').nth(50)).toBeAttached();
	await expect(page.locator('.preview')).toHaveScreenshot('all-soft-dark.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.001
	});
});
