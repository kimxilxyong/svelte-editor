/**
 * @fileoverview End-to-end coverage of per-user projects: a newly registered user starts with one
 * empty project and can neither see nor open another user's project, while the administrator sees
 * all projects; create / rename / duplicate / delete flows on the Projects page; navigation order
 * and the `/pages` route.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const password = 'Correct-Horse-Battery-9!';

async function hydrated(page: Page) {
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
}

/** Registers a fresh user in an isolated browser context and returns its page. */
async function registerUser(browser: Browser, name: string) {
	// The project's stored administrator session must not leak into the new user's context.
	const context = await browser.newContext({
		baseURL: 'http://localhost:4173',
		storageState: { cookies: [], origins: [] }
	});
	const page = await context.newPage();
	const email = `${name.toLowerCase()}-${Date.now()}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.locator('#reg-name').fill(name);
	await page.locator('#reg-email').fill(email);
	await page.locator('input[type="password"]').first().fill(password);
	await page.locator('input[type="password"]').nth(1).fill(password);
	await page.getByRole('button', { name: /create account|register/i }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/register'));
	return { page, context, email };
}

test('the Projects page is the home page and sits left of Pages', async ({ page }) => {
	await page.goto('/');
	await hydrated(page);
	await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeVisible();
	const tabs = page.getByRole('list', { name: 'Go to' }).getByRole('link');
	const labels = await tabs.allTextContents();
	expect(labels.map((label) => label.trim()).slice(0, 2)).toEqual(['Projects', 'Pages']);
	await page.getByRole('list', { name: 'Go to' }).getByRole('link', { name: 'Pages' }).click();
	await expect(page).toHaveURL(/\/pages$/);
	await expect(page.getByRole('complementary', { name: 'Pages' })).toBeVisible();
});

test('create, rename, duplicate and delete a project', async ({ page }) => {
	const name = `E2E ${Date.now()}`;
	await page.goto('/');
	await hydrated(page);

	await page.getByTestId('new-project').click();
	await page.getByLabel('New project name').fill(name);
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	const item = page.getByTestId('project-item').filter({ hasText: name });
	await expect(item).toBeVisible();
	await expect(item).toContainText('0 pages');
	await expect(page.getByTestId('project-empty-callout')).toBeVisible();

	// The new project is the active one: the editor starts empty with only widgets available.
	await page.goto('/editor');
	await hydrated(page);
	await expect(page.getByTestId('editor-empty')).toContainText('No pages');
	await page.getByRole('button', { name: 'Add first page' }).click();
	await expect(page.locator('.page-canvas')).toBeVisible();
	await page.getByRole('tab', { name: 'Widgets' }).click();
	await expect(page.locator('.palette-item').first()).toBeVisible();
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');

	await page.goto('/');
	await hydrated(page);
	await expect(item).toContainText('1 page');

	// Rename via the settings panel.
	const renamed = `${name} renamed`;
	await item.click();
	await page.locator('#project-name').fill(renamed);
	await page.getByRole('button', { name: 'Save settings' }).first().click();
	const renamedItem = page.getByTestId('project-item').filter({ hasText: renamed });
	await expect(renamedItem).toBeVisible();

	// Duplicate through the row menu (left-click on the ⋯ button).
	await page.getByRole('button', { name: `Actions for ${renamed}` }).click();
	await page.getByRole('menuitem', { name: 'Duplicate' }).click();
	const copy = page.getByTestId('project-item').filter({ hasText: `${renamed} copy` });
	await expect(copy).toBeVisible();
	await expect(copy).toContainText('1 page');

	// Delete both with the typed confirmation.
	for (const target of [copy, renamedItem]) {
		await target.click();
		await page.getByRole('button', { name: 'Delete project…' }).click();
		const confirm = page.getByTestId('confirm-delete');
		await expect(confirm).toBeDisabled();
		await page.getByLabel('Type the project name to confirm').fill(
			await target
				.locator('strong')
				.first()
				.innerText()
				.then((text) => text.replace(/\s*Open\s*$/, '').trim())
		);
		await confirm.click();
		await expect(target).toHaveCount(0);
	}
});

test('users only see their own projects; the admin sees all', async ({ page, browser }) => {
	const adminProject = await page.goto('/projects/api').then((response) => response?.json());
	const adminProjectId = (adminProject as { projects: { id: string }[] }).projects[0].id;

	const bob = await registerUser(browser, 'Bob');
	try {
		// A new user is a Power user with exactly one empty project.
		await bob.page.goto('/');
		await hydrated(bob.page);
		await expect(bob.page.getByTestId('project-item')).toHaveCount(1);
		await expect(bob.page.getByTestId('project-item')).toContainText('My first project');
		await expect(bob.page.getByTestId('project-item')).toContainText('0 pages');
		await expect(bob.page.getByRole('link', { name: 'Code' })).toBeVisible();
		await expect(bob.page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

		// Pages and the editor are empty: no pages and no composites, only widgets.
		await bob.page.goto('/pages');
		await hydrated(bob.page);
		await expect(bob.page.getByTestId('pages-empty')).toContainText('No pages yet');
		await bob.page.goto('/composites');
		await hydrated(bob.page);
		await expect(bob.page.getByTestId('editor-empty')).toContainText('No composites');
		const site = await bob.page.request.get('/editor/api');
		expect(await site.json()).toMatchObject({ site: { pages: [], composites: [] } });

		// Bob cannot list, open or change the administrator's project.
		const list = await bob.page.request.get('/projects/api');
		const { projects } = (await list.json()) as { projects: { id: string }[] };
		expect(projects.map((project) => project.id)).not.toContain(adminProjectId);
		for (const action of ['open', 'update', 'delete', 'duplicate']) {
			const response = await bob.page.request.post('/projects/api', {
				data: { action, id: adminProjectId, name: 'hacked' }
			});
			expect(response.status()).toBe(404);
		}
		// A forged active-project cookie is ignored.
		await bob.context.addCookies([
			{ name: 'active_project', value: adminProjectId, url: 'http://localhost:4173' }
		]);
		const forged = await bob.page.request.get('/editor/api');
		expect(await forged.json()).toMatchObject({
			project: { name: 'My first project' },
			site: { pages: [] }
		});

		// The administrator sees Bob's project with its owner, and the own ones.
		await page.goto('/');
		await hydrated(page);
		await expect(page.getByTestId('project-item').filter({ hasText: /Bob/ }).first()).toBeVisible();
		expect(await page.getByTestId('project-item').count()).toBeGreaterThanOrEqual(2);
	} finally {
		await bob.context.close();
	}
});
