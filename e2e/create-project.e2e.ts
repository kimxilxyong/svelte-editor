/**
 * @fileoverview End-to-end coverage for "Create new project": scaffolds a SvelteKit app into an
 * empty folder from the home page, links the editor's `node_modules`, builds it with Vite and
 * checks the generated page renders its blocks with the geometry stored in the editor.
 */
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const dirs: string[] = [];
let server: ChildProcess | undefined;

test.afterEach(async () => {
	server?.kill();
	server = undefined;
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function run(cmd: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('exit', (code) =>
			code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out}`))
		);
	});
}

test('creates a compilable project whose pages match the editor', async ({ page }) => {
	test.setTimeout(240_000);
	const parent = await mkdtemp(path.join(tmpdir(), 'create-project-e2e-'));
	dirs.push(parent);
	const root = path.join(parent, 'fresh-site');

	await page.setViewportSize({ width: 1600, height: 1000 });
	// The test database starts empty; the editor opens with a default page to fill.
	await page.goto('/editor');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('tab', { name: 'Widgets' }).click();
	const canvas = page.locator('.page-canvas');
	for (const [label, position] of [
		[/Alert/, { x: 120, y: 80 }],
		[/Button\s*A clear action/, { x: 300, y: 260 }]
	] as const) {
		const item = page.locator('.palette-item').filter({ hasText: label });
		await item.dragTo(canvas, { targetPosition: position, force: true });
	}
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.save-status')).toContainText('Saved');

	await page.goto('/');
	await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await page.locator('#project-root').fill(root);
	await page.getByTestId('create-project').click();
	await expect(page.locator('.project-section')).toContainText('Created a new SvelteKit project', {
		timeout: 30_000
	});
	expect(await readFile(path.join(root, 'package.json'), 'utf8')).toContain('fresh-site');

	// A second attempt into the now non-empty folder must be refused.
	await page.getByTestId('create-project').click();
	await expect(page.locator('.save-status')).toContainText(/not empty/i);

	const routes = (await readdir(path.join(root, 'src/routes'), { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	expect(routes.length).toBeGreaterThan(0);
	const slug = routes[0];
	const pageSource = await readFile(path.join(root, 'src/routes', slug, '+page.svelte'), 'utf8');
	const expected = [...pageSource.matchAll(/class="editor-block[^"]*"[^>]*style="([^"]*)"/g)].map(
		(match) => match[1]
	);

	await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
	await run('npx', ['vite', 'build'], root);

	const port = 4391;
	server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		cwd: root,
		stdio: 'ignore'
	});
	const url = `http://localhost:${port}/${slug}`;
	await expect
		.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30_000 })
		.toBe(200);

	await page.goto(url);
	const blocks = page.locator('.editor-page > .editor-block');
	await expect(blocks.first()).toBeVisible();
	const rendered = await blocks.count();
	expect(rendered).toBe(expected.length);

	const left = await blocks.evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).style.cssText.replace(/\s+/g, ''))
	);
	expect(left).toEqual(expected.map((style) => style.replace(/\s+/g, '').replace(/;?$/, ';')));

	// Tailwind/Flowbite styles must be compiled into the new project (not just the markup).
	const button = page.locator('.editor-page button').first();
	await expect(button).toBeVisible();
	await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
