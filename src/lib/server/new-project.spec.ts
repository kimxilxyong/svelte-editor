import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { seedComposites } from '../composite-seeds.js';
import type { EditorSite } from '../editor.js';
import { createProject, packageNameFor } from './new-project.js';
import { ProjectError } from './project.js';

const dirs: string[] = [];

async function tempDir() {
	const dir = await mkdtemp(path.join(tmpdir(), 'editor-new-project-'));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const site: EditorSite = {
	pages: [
		{
			id: 'a',
			name: 'Home',
			slug: 'welcome',
			width: 800,
			height: 600,
			blocks: [
				{
					id: 'b1',
					kind: 'widget-button',
					title: '',
					body: '',
					action: 'Go',
					theme: 'light',
					positioned: true,
					x: 20,
					y: 40,
					width: 120,
					height: 40,
					value: '',
					checked: false,
					level: 60,
					href: '/welcome',
					newTab: false
				}
			]
		}
	],
	composites: seedComposites()
};

describe('packageNameFor', () => {
	it('derives a valid npm name from a folder name', () => {
		expect(packageNameFor('My Great Site!')).toBe('my-great-site');
		expect(packageNameFor('___')).toBe('my-site');
	});
});

describe('createProject', () => {
	it('scaffolds a complete project into an empty folder', async () => {
		const root = await tempDir();
		const result = await createProject(root, site);

		expect(result.skipped).toEqual([]);
		expect(result.installed).toBe(false);
		for (const file of [
			'package.json',
			'vite.config.ts',
			'tsconfig.json',
			'src/app.html',
			'src/app.css',
			'src/routes/+layout.svelte',
			'src/routes/+page.ts',
			'src/routes/welcome/+page.svelte',
			'src/lib/theme.ts',
			'src/lib/site-theme.ts',
			'src/lib/components/editor/WidgetButton.svelte',
			'src/lib/components/editor/ThemeScope.svelte',
			'static/favicon.svg'
		]) {
			expect(await readFile(path.join(root, file), 'utf8'), file).not.toBe('');
		}

		const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
		expect(manifest.name).toMatch(/^editor-new-project-/);
		expect(manifest.imports).toEqual({
			'#lib': './src/lib/index.js',
			'#lib/*': './src/lib/*'
		});
		expect(Object.keys(manifest.devDependencies)).toEqual(
			expect.arrayContaining(['@sveltejs/kit', 'flowbite-svelte', 'tailwindcss', 'svelte'])
		);
		const viteConfig = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
		expect(viteConfig).not.toContain('alias:');
		expect(await readFile(path.join(root, 'src/routes/+page.ts'), 'utf8')).toContain('/welcome');
		const page = await readFile(path.join(root, 'src/routes/welcome/+page.svelte'), 'utf8');
		expect(page).toContain("from '#lib/components/editor/WidgetButton.svelte'");
		expect(page).toContain("from '#lib/site-theme.js'");
		const hero = await readFile(path.join(root, 'src/lib/components/editor/Hero.svelte'), 'utf8');
		expect(hero).toContain("from '#lib/components/editor/WidgetCard.svelte'");
	});

	it('writes svelte files that compile', async () => {
		const root = await tempDir();
		await createProject(root, site);
		const files = [
			'src/routes/+layout.svelte',
			'src/routes/welcome/+page.svelte',
			// The folder also holds the `.editor-composites.json` export manifest.
			...(await readdir(path.join(root, 'src/lib/components/editor')))
				.filter((name) => name.endsWith('.svelte'))
				.map((name) => `src/lib/components/editor/${name}`)
		];
		for (const file of files) {
			const source = await readFile(path.join(root, file), 'utf8');
			expect(() => compile(source, { filename: file, generate: 'client' }), file).not.toThrow();
		}
	});

	it('creates the folder when only its parent exists', async () => {
		const parent = await tempDir();
		const root = path.join(parent, 'brand-new');
		const result = await createProject(root, site);
		expect(result.name).toBe('brand-new');
		expect(await readFile(path.join(root, 'package.json'), 'utf8')).toContain('brand-new');
	});

	it('shows a placeholder home page when the site has no pages', async () => {
		const root = await tempDir();
		await createProject(root, { pages: [], composites: [] });
		expect(await readFile(path.join(root, 'src/routes/+page.svelte'), 'utf8')).toContain(
			'no pages yet'
		);
	});

	it('tolerates a .git folder', async () => {
		const root = await tempDir();
		await mkdir(path.join(root, '.git'));
		await expect(createProject(root, site)).resolves.toBeTruthy();
	});

	it('refuses folders that are not empty and leaves them untouched', async () => {
		const root = await tempDir();
		await writeFile(path.join(root, 'notes.txt'), 'keep me');
		await expect(createProject(root, site)).rejects.toThrow(/not empty/);
		expect(await readdir(root)).toEqual(['notes.txt']);
	});

	it('refuses relative paths, missing parents and files', async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, 'file.txt'), 'x');
		await expect(createProject('relative/path', site)).rejects.toBeInstanceOf(ProjectError);
		await expect(createProject(path.join(dir, 'a', 'b'), site)).rejects.toThrow(/parent/);
		await expect(createProject(path.join(dir, 'file.txt'), site)).rejects.toThrow(/not a folder/);
		await expect(createProject('', site)).rejects.toBeInstanceOf(ProjectError);
	});
});
