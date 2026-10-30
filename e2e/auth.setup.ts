/**
 * @fileoverview Creates the first administrator on the fresh e2e database (`/setup`) and stores
 * the signed-in browser state for the `chromium` project.
 */
import { test as setup } from '@playwright/test';

const email = 'e2e@example.com';
const password = 'Correct-Horse-Battery-9!';

setup('create administrator and sign in', async ({ page }) => {
	await page.goto('/setup', { waitUntil: 'networkidle' });
	await page.fill('#setup-name', 'E2E Admin');
	await page.fill('#setup-email', email);
	await page.locator('input[type="password"]').first().fill(password);
	await page.locator('input[type="password"]').nth(1).fill(password);
	await page.getByRole('button', { name: 'Create administrator' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/setup'));
	await page.context().storageState({ path: '.data/e2e-auth.json' });
});
