/**
 * @fileoverview Exercises SvelteKit project export/import, including the bounded, conflict-safe
 * image snapshot format. Fixtures live under the repository and are removed after each test.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { compositeKind, componentNames, type BlockKind, type EditorSite } from '../editor.js';
import { seedComposites } from '../composite-seeds.js';
import type { ImageExportRecord } from '../image-types.js';
import {
	exportSite,
	importSite,
	exportSingleComponent,
	importSingleComponent,
	ProjectError
} from './project.js';

const dirs: string[] = [];

async function makeProject() {
	const root = path.join(process.cwd(), `.project-fixture-${randomUUID()}`);
	await mkdir(root);
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
		await expect(importSite(path.join(process.cwd(), 'src'))).rejects.toBeInstanceOf(ProjectError);
	});
});

const emptySite: EditorSite = { pages: [], composites: [] };
const managedBytes = Buffer.from('portable image bytes');
const managed: ImageExportRecord = {
	id: 'img_1',
	name: 'Managed image',
	url: '/media/img_1.png',
	category: 'Photos',
	kind: 'managed',
	mimeType: 'image/png',
	size: managedBytes.length,
	data: managedBytes.toString('base64')
};
const linked: ImageExportRecord = {
	id: 'external-1',
	name: 'External image',
	url: 'https://images.unsplash.com/photo-example?auto=format',
	category: 'Backgrounds',
	kind: 'link'
};
const manifestPath = path.join('static', 'media', '.svelte-editor-images.json');

/** Write a deliberately constructed manifest for negative import tests. */
async function writeManifest(root: string, images: unknown[]) {
	await mkdir(path.join(root, 'static', 'media'), { recursive: true });
	await writeFile(
		path.join(root, manifestPath),
		JSON.stringify({ generator: 'svelte-editor', version: 1, images })
	);
}

function diskManaged() {
	const image = { ...managed };
	delete image.data;
	return { ...image, sha256: createHash('sha256').update(managedBytes).digest('hex') };
}

describe('project image portability', () => {
	it('round-trips managed bytes and external links and preserves absent-vs-empty snapshots', async () => {
		const root = await makeProject();
		expect((await importSite(root)).images).toBeUndefined();
		const result = await exportSite(root, emptySite, undefined, { images: [managed, linked] });
		expect(result.skipped).toEqual([]);
		expect(result.written).toContain(path.join('static', 'media', 'img_1.png'));
		expect(result.written).toContain(manifestPath);
		expect(await readFile(path.join(root, 'static', 'media', 'img_1.png'))).toEqual(managedBytes);
		const text = await readFile(path.join(root, manifestPath), 'utf8');
		expect(text).not.toContain(managed.data);
		expect((await importSite(root)).images).toEqual([managed, linked]);

		// Identical files are safe; an existing generated manifest can be updated.
		const second = await exportSite(root, emptySite, undefined, { images: [linked] });
		expect(second.skipped).toEqual([]);
		expect((await importSite(root)).images).toEqual([linked]);
		await exportSite(root, emptySite, undefined, { images: [] });
		expect((await importSite(root)).images).toEqual([]);
	});

	it('reports conflicts without overwriting existing files or writing an incomplete manifest', async () => {
		const root = await makeProject();
		await mkdir(path.join(root, 'static', 'media'), { recursive: true });
		const file = path.join(root, 'static', 'media', 'img_1.png');
		await writeFile(file, 'user image');
		const result = await exportSite(root, emptySite, undefined, { images: [managed, linked] });
		expect(result.skipped.map((item) => item.file)).toEqual([
			path.join('static', 'media', 'img_1.png'),
			manifestPath
		]);
		expect(await readFile(file, 'utf8')).toBe('user image');
		expect((await importSite(root)).images).toBeUndefined();

		await writeFile(path.join(root, manifestPath), 'user manifest');
		const conflict = await exportSite(root, emptySite, undefined, { images: [linked] });
		expect(conflict.skipped.some((item) => item.file === manifestPath)).toBe(true);
		expect(await readFile(path.join(root, manifestPath), 'utf8')).toBe('user manifest');
	});

	it('preserves a previous manifest when a managed destination conflicts', async () => {
		const root = await makeProject();
		await exportSite(root, emptySite, undefined, { images: [managed] });
		const before = await readFile(path.join(root, manifestPath));
		const changed = Buffer.from('new data');
		const result = await exportSite(root, emptySite, undefined, {
			images: [{ ...managed, size: changed.length, data: changed.toString('base64') }]
		});
		expect(result.skipped.some((item) => item.file === manifestPath)).toBe(true);
		expect(await readFile(path.join(root, manifestPath))).toEqual(before);
		expect((await importSite(root)).images).toEqual([managed]);
	});

	it('does not replace a manifest whose recorded managed bytes no longer match', async () => {
		const root = await makeProject();
		await exportSite(root, emptySite, undefined, { images: [managed] });
		const before = await readFile(path.join(root, manifestPath));
		await writeFile(path.join(root, 'static', 'media', 'img_1.png'), 'edited outside editor');
		const result = await exportSite(root, emptySite, undefined, { images: [linked] });
		expect(result.skipped.some((item) => item.file === manifestPath)).toBe(true);
		expect(await readFile(path.join(root, manifestPath))).toEqual(before);
	});

	it('rejects traversal, duplicate identifiers, invalid base64 and inconsistent sizes', async () => {
		const root = await makeProject();
		for (const image of [
			{ ...managed, url: '/media/../img_1.png' },
			{ ...managed, url: '/media/%2e%2e.png' },
			{ ...managed, data: '!!!!' },
			{ ...managed, data: 'YQ' },
			{ ...managed, size: 1 }
		]) {
			await expect(
				exportSite(root, emptySite, undefined, { images: [image] })
			).rejects.toBeInstanceOf(ProjectError);
		}
		await expect(
			exportSite(root, emptySite, undefined, { images: [linked, linked] })
		).rejects.toBeInstanceOf(ProjectError);
		await writeManifest(root, [{ ...diskManaged(), url: '/media/../../secret.png' }]);
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
	});

	it('rejects missing, modified, malformed and oversized image snapshots', async () => {
		const root = await makeProject();
		await writeManifest(root, [diskManaged()]);
		await expect(importSite(root)).rejects.toThrow(/Missing or invalid managed image/);
		await writeFile(path.join(root, 'static', 'media', 'img_1.png'), 'modified');
		await expect(importSite(root)).rejects.toThrow(/Missing or invalid managed image/);
		await writeFile(
			path.join(root, manifestPath),
			JSON.stringify({ generator: 'svelte-editor', version: 2, images: [] })
		);
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
		await writeFile(path.join(root, manifestPath), 'x'.repeat(1024 * 1024 + 1));
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
		await expect(
			exportSite(root, emptySite, undefined, {
				images: Array.from({ length: 501 }, (_, i) => ({ ...linked, id: String(i) }))
			})
		).rejects.toBeInstanceOf(ProjectError);
		await expect(
			exportSite(root, emptySite, undefined, {
				images: [
					{
						...managed,
						size: 10 * 1024 * 1024 + 1,
						data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')
					}
				]
			})
		).rejects.toBeInstanceOf(ProjectError);
	});

	it('rejects symlinked media directories, manifests and managed files', async () => {
		const root = await makeProject();
		const outside = await makeProject();
		await mkdir(path.join(root, 'static'));
		await symlink(outside, path.join(root, 'static', 'media'));
		expect(
			(await exportSite(root, emptySite, undefined, { images: [managed] })).skipped[0].file
		).toBe(manifestPath);
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
		await unlink(path.join(root, 'static', 'media'));
		await mkdir(path.join(root, 'static', 'media'));
		await writeFile(path.join(outside, 'manifest'), 'outside');
		await symlink(path.join(outside, 'manifest'), path.join(root, manifestPath));
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
		expect(
			(await exportSite(root, emptySite, undefined, { images: [managed] })).skipped[0].file
		).toBe(manifestPath);
		await unlink(path.join(root, manifestPath));
		await writeManifest(root, [diskManaged()]);
		await writeFile(path.join(outside, 'image.png'), managedBytes);
		await symlink(path.join(outside, 'image.png'), path.join(root, 'static', 'media', 'img_1.png'));
		await expect(importSite(root)).rejects.toBeInstanceOf(ProjectError);
		await unlink(path.join(root, manifestPath));
		const conflict = await exportSite(root, emptySite, undefined, { images: [managed] });
		expect(conflict.skipped.some((item) => item.file.endsWith('img_1.png'))).toBe(true);
		expect(await readFile(path.join(outside, 'image.png'))).toEqual(managedBytes);
	});
});
