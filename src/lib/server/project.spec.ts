import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { componentNames, type BlockKind, type EditorSite } from '../editor.js';
import {
	exportSite,
	importSite,
	exportSingleComponent,
	importSingleComponent,
	ProjectError
} from './project.js';

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
	it('exports all 20 native components and compilable pages', async () => {
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
		// All 20 built-in components are scanned in src/lib/components/editor
		expect(imported.components.length).toBeGreaterThanOrEqual(20);
	});

	it('imports custom native Svelte components added to the project', async () => {
		const root = await makeProject();
		await exportSite(root, site);

		// Add a custom native Svelte component to src/lib/components/
		const customCompDir = path.join(root, 'src', 'lib', 'components');
		await mkdir(customCompDir, { recursive: true });
		const customCompCode = `
<script lang="ts">
  interface Props {
    heading?: string;
    subscribedCount?: number;
    optIn?: boolean;
  }
  let { heading = 'Join us', subscribedCount = 500, optIn = true }: Props = $props();
</script>
<section>
  <h2>{heading}</h2>
  <p>{subscribedCount} members</p>
</section>
`;
		await writeFile(path.join(customCompDir, 'NewsletterSignup.svelte'), customCompCode);

		// Import the project
		const imported = await importSite(root);
		const found = imported.components.find((c) => c.name === 'NewsletterSignup');
		expect(found).toBeDefined();
		expect(found?.fileName).toBe('NewsletterSignup.svelte');
		expect(found?.props.map((p) => p.name)).toContain('heading');
		expect(found?.props.map((p) => p.name)).toContain('subscribedCount');
		expect(found?.props.map((p) => p.name)).toContain('optIn');
	});

	it('supports exportSingleComponent and importSingleComponent', async () => {
		const root = await makeProject();
		const exported = await exportSingleComponent(root, 'WidgetSlider');
		expect(exported.written).toBe(
			path.join('src', 'lib', 'components', 'editor', 'WidgetSlider.svelte')
		);

		const imported = await importSingleComponent(root, exported.written);
		expect(imported.name).toBe('WidgetSlider');
		expect(imported.props.map((p) => p.name)).toContain('level');
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
