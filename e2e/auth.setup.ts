/**
 * @fileoverview Creates the first administrator on the fresh e2e database (`/setup`), fills the
 * administrator's first project with the starter content the editor suites rely on (a Home page that
 * uses the starter composites, plus the starter composites themselves) and stores the signed-in
 * browser state – including the active-project cookie – for the `chromium` project.
 *
 * New projects are empty by design, so without the seeding the existing suites would start on an
 * empty editor.
 */
import { expect, test as setup } from '@playwright/test';
import { seedComposites } from '../src/lib/composite-seeds.js';
import { compositeKind, type BuilderBlock, type EditorSite } from '../src/lib/editor.js';

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

	// The first project exists already; make it the active one explicitly and fill it.
	const listed = await page.request.get('/projects/api');
	const { projects } = (await listed.json()) as { projects: { id: string }[] };
	expect(projects).toHaveLength(1);
	await page.request.post('/projects/api', { data: { action: 'open', id: projects[0].id } });

	const sampleBlocks: BuilderBlock[] = (
		[
			['sample-hero', 'Hero', 24, 720, 220],
			['sample-features', 'FeatureCards', 264, 720, 260],
			['sample-quote', 'Testimonial', 544, 720, 200]
		] as const
	).map(([id, name, y, width, height]) => ({
		id,
		kind: compositeKind(name),
		title: '',
		body: '',
		action: '',
		theme: 'light',
		alignTo: 'none',
		positioned: true,
		x: 24,
		y,
		width,
		height,
		value: '',
		checked: false,
		level: 60,
		href: '',
		newTab: false
	}));
	const site: EditorSite = {
		pages: [
			{ id: 'home', name: 'Home', slug: 'home', width: 1920, height: 1080, blocks: sampleBlocks }
		],
		composites: seedComposites()
	};
	const current = await page.request.get('/editor/api');
	const { revision } = (await current.json()) as { revision: number };
	const saved = await page.request.post('/editor/api', {
		data: { action: 'save', site, revision, expectedProjectId: projects[0].id }
	});
	expect(saved.ok()).toBe(true);

	await page.context().storageState({ path: process.env.E2E_AUTH_PATH ?? '.data/e2e-auth.json' });
});
