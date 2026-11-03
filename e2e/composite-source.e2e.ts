/**
 * @fileoverview End-to-end proof that a composite's native source, edited in `/component-editor`
 * → **Composites**, is persisted, survives a stale visual-editor save, drives the `/composites`
 * preview and is written byte-for-byte by the project export. It uses its own composite so the
 * shared starter composites (and the visual snapshot suites) are never touched, and removes it
 * again at the end.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { EditorComposite, EditorSite } from '../src/lib/editor.js';

const name = 'SourceRoundTrip';
const marker = 'Native source survives';

async function loadSite(page: Page): Promise<EditorSite> {
	const response = await page.request.get('/editor/api');
	expect(response.ok()).toBe(true);
	return ((await response.json()) as { site: EditorSite }).site;
}

async function saveSite(page: Page, site: EditorSite): Promise<void> {
	const response = await page.request.post('/editor/api', { data: { action: 'save', site } });
	expect(response.ok(), await response.text()).toBe(true);
}

/** Replaces a CodeMirror document; `insertText` bypasses bracket/tag auto-closing. */
async function replaceEditor(page: Page, label: string, text: string): Promise<void> {
	const content = page.locator(`.cm-content[aria-label="${label}"]`);
	await content.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(text);
}

test('composite native source persists and drives preview and export', async ({ page }) => {
	const original = await loadSite(page);
	// Export remembers the folder as the project path; restore it for the other suites.
	const listed = (await (await page.request.get('/projects/api')).json()) as {
		projects: { id: string; path: string }[];
		activeId: string;
	};
	const project = listed.projects.find((item) => item.id === listed.activeId)!;
	const composite: EditorComposite = {
		id: 'e2e-source-round-trip',
		name,
		width: 480,
		height: 160,
		blocks: []
	};
	await saveSite(page, {
		...original,
		composites: [...original.composites.filter((item) => item.name !== name), composite]
	});
	const staleVisualSnapshot = await loadSite(page);
	const exportRoot = await mkdtemp(path.join(tmpdir(), 'composite-source-'));

	try {
		// 1. Edit Script / Markup / Style in the code editor and save.
		await page.goto('/component-editor');
		await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
		await page.getByRole('tab', { name: 'Composites', exact: true }).click();
		await page.getByRole('searchbox', { name: 'Find', exact: true }).fill(name.toLowerCase());
		await page.getByRole('button', { name, exact: true }).click();
		await replaceEditor(page, 'Component script', `let text = $state('${marker}');`);
		await replaceEditor(page, 'Component markup', '<p class="round-trip">{text}</p>');
		await replaceEditor(page, 'Component style', '.round-trip { color: rgb(12, 34, 56); }');
		await expect(page.locator('.composite-source-preview')).toContainText(marker);
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByRole('button', { name: `${name} edited` })).toBeVisible();

		// 2. Persisted in the database.
		const saved = (await loadSite(page)).composites.find((item) => item.name === name);
		expect(saved?.source).toContain('<p class="round-trip">{text}</p>');
		expect(saved?.source).toContain(marker);
		const exactSource = saved!.source!;

		// 3. A stale visual save (taken before the code edit) does not drop the override.
		await saveSite(page, staleVisualSnapshot);
		const afterVisual = (await loadSite(page)).composites.find((item) => item.name === name);
		expect(afterVisual?.source).toBe(exactSource);

		// 4. The visual Composites editor's preview renders the native source.
		await page.goto('/composites');
		await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
		await page.getByRole('combobox', { name: 'Composite', exact: true }).selectOption(name);
		await page.getByRole('button', { name: 'Preview', exact: true }).click();
		const rendered = page.locator('.page-canvas p.round-trip');
		await expect(rendered).toHaveText(marker);
		await expect(rendered).toHaveCSS('color', 'rgb(12, 34, 56)');

		// 5. Export writes the exact source.
		await mkdir(path.join(exportRoot, 'src', 'routes'), { recursive: true });
		await writeFile(path.join(exportRoot, 'package.json'), '{ "name": "export-check" }');
		const exported = await page.request.post('/editor/api/project', {
			data: { action: 'export', root: exportRoot }
		});
		expect(exported.ok(), await exported.text()).toBe(true);
		const file = path.join(exportRoot, 'src', 'lib', 'components', 'editor', `${name}.svelte`);
		expect(await readFile(file, 'utf8')).toBe(exactSource);
	} finally {
		const current = await loadSite(page);
		await saveSite(page, {
			...current,
			composites: current.composites.filter((item) => item.name !== name)
		});
		await rm(exportRoot, { recursive: true, force: true });
		await page.request.post('/projects/api', {
			data: { action: 'update', id: project.id, path: project.path }
		});
	}
});
