import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { componentNames, type BlockKind, type EditorSite } from '../editor.js';
import { exportSite, importSite, ProjectError } from './project.js';

const dirs: string[] = [];

async function makeProject() {
	const root = await mkdtemp(path.join(tmpdir(), 'editor-project-'));
	dirs.push(root);
	await writeFile(path.join(root, 'package.json'), '{}');
	await mkdir(path.join(root, 'src', 'routes'), { recursive: true });
	return root;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const site: EditorSite = {
	pages: [
		{
			id: 'a',
			name: 'Home',
			slug: 'home',
			width: 800,
			height: 600,
			blocks: (Object.keys(componentNames) as BlockKind[]).map((kind, index) => ({
				id: `b${index}`,
				kind,
				title: 'Title',
				body: 'Body',
				action: 'Go',
				theme: 'light' as const,
				positioned: true,
				x: 5,
				y: 40 + index * 10,
				width: 50,
				height: 120,
				value: '',
				checked: false,
				level: 60,
				href: '',
				newTab: false
			}))
		}
	]
};

describe('project export/import', () => {
	it('exports compilable files and imports them back', async () => {
		const root = await makeProject();
		const result = await exportSite(root, site);
		expect(result.skipped).toEqual([]);
		expect(result.written).toContain(path.join('src', 'routes', 'home', '+page.svelte'));
		expect(result.written).toHaveLength(21);

		for (const file of result.written) {
			const source = await readFile(path.join(root, file), 'utf8');
			expect(() => compile(source, { filename: file, runes: true })).not.toThrow();
		}

		const imported = await importSite(root);
		expect(imported.pages).toHaveLength(1);
		expect(imported.pages[0].slug).toBe('home');
		expect(imported.pages[0].blocks).toHaveLength(20);
	});

	it('never overwrites files it did not generate', async () => {
		const root = await makeProject();
		await mkdir(path.join(root, 'src', 'routes', 'home'));
		const own = path.join(root, 'src', 'routes', 'home', '+page.svelte');
		await writeFile(own, '<h1>mine</h1>');
		const result = await exportSite(root, site);
		expect(result.skipped.map((item) => item.file)).toEqual([path.relative(root, own)]);
		expect(await readFile(own, 'utf8')).toBe('<h1>mine</h1>');
	});

	it('rejects non-project folders and relative paths', async () => {
		await expect(exportSite('relative/path', site)).rejects.toBeInstanceOf(ProjectError);
		await expect(importSite(tmpdir())).rejects.toBeInstanceOf(ProjectError);
	});
});
