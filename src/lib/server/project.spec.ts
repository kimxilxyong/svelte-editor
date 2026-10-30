import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { compositeKind, componentNames, type BlockKind, type EditorSite } from '../editor.js';
import { seedComposites } from '../composite-seeds.js';
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
	],
	composites: []
};

describe('project export/import', () => {
	it('exports all native components and compilable pages', async () => {
		const root = await makeProject();
		const result = await exportSite(root, site);
		expect(result.skipped).toEqual([]);
		expect(result.warnings[0]).toContain('flowbite-svelte');
		expect(result.written).toContain(path.join('src', 'routes', 'home', '+page.svelte'));
		// components + page + ThemeScope + src/lib/theme.ts + src/lib/site-theme.ts
		expect(result.written).toHaveLength(Object.keys(componentNames).length + 4);
		expect(result.written).toContain(path.join('src', 'lib', 'site-theme.ts'));
		const page = await readFile(path.join(root, 'src', 'routes', 'home', '+page.svelte'), 'utf8');
		expect(page).toContain('<ThemeScope theme={siteTheme}>');

		for (const file of result.written.filter((name) => name.endsWith('.svelte'))) {
			const source = await readFile(path.join(root, file), 'utf8');
			expect(() => compile(source, { filename: file, runes: true })).not.toThrow();
		}

		const imported = await importSite(root);
		expect(imported.pages).toHaveLength(1);
		expect(imported.pages[0].slug).toBe('home');
		expect(imported.pages[0].blocks).toHaveLength(Object.keys(componentNames).length);
		// All built-in components are scanned in src/lib/components/editor
		expect(imported.components.length).toBeGreaterThanOrEqual(Object.keys(componentNames).length);
	});

	it('round-trips composite components and the pages that use them', async () => {
		const root = await makeProject();
		const [hero] = seedComposites();
		const withComposite: EditorSite = {
			composites: [hero],
			pages: [
				{
					...site.pages[0],
					blocks: [{ ...site.pages[0].blocks[0], id: 'c1', kind: compositeKind(hero.name) }]
				}
			]
		};
		const result = await exportSite(root, withComposite);
		const file = path.join('src', 'lib', 'components', 'editor', `${hero.name}.svelte`);
		expect(result.written).toContain(file);
		const source = await readFile(path.join(root, file), 'utf8');
		expect(() => compile(source, { filename: file, runes: true })).not.toThrow();

		const imported = await importSite(root);
		expect(imported.composites.map((c) => c.name)).toEqual([hero.name]);
		expect(imported.pages[0].blocks.map((b) => b.kind)).toEqual([compositeKind(hero.name)]);
		// Generated composites are not offered as imported native components.
		expect(imported.components.map((c) => c.name)).not.toContain(hero.name);
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
