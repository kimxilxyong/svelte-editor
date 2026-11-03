/**
 * @fileoverview Native composite route interactions with real CodeMirror and Svelte runtime.
 * All HTTP actions use isolated memory fixtures; no shared database or project files are touched.
 * Covers Find across modes, exact Script/Markup/Style save/reopen, native preview, reset,
 * confirmation, compiler rejection and stale asynchronous reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { EditorView } from '@codemirror/view';
import { tick } from 'svelte';
import { checkSvelteSource } from '../../lib/svelte-diagnostics.js';
import { renderCompositeSource } from '../../lib/svelte-pages.js';
import type { EditorComposite } from '../../lib/editor.js';
import ComponentEditorPage from './+page.svelte';
import '../layout.css';

vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	invalidateAll: vi.fn(),
	goto: vi.fn()
}));
vi.mock('$app/state', () => ({ page: { data: { project: { id: 'memory', path: '/memory' } } } }));

const original = `<script lang="ts">let title = $state('Original composite');</script>
<p class="native">{title}</p>
<style>.native { color: rgb(11, 22, 33); }</style>`;
let definitions: EditorComposite[];
let revision: number;
let savedSource: string | undefined;

/** Gets the actual editor document, independent of viewport/CodeMirror text virtualization. */
function editor(label: string): EditorView {
	const element = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);
	const view = element && EditorView.findFromDOM(element);
	if (!view) throw new Error(`Missing ${label}`);
	return view;
}

/** Replaces one part via the existing editor API without changing CodeEditor implementation. */
async function edit(label: string, content: string) {
	const view = editor(label);
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
	await tick();
}

/** Memory HTTP fixture keeps code edits separate from visual metadata, just like project-store. */
async function memoryFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
	const path = String(url);
	if (!init?.body) return Response.json({ overrides: {} });
	const body = JSON.parse(String(init.body));
	if (path === '/component-editor/composites') {
		if (body.action === 'list') return Response.json({ composites: definitions });
		const composite = definitions.find((item) => item.id === body.id);
		if (!composite) return Response.json({ error: 'Composite not found.' }, { status: 404 });
		if (body.action === 'save' || body.action === 'reset') {
			if (body.revision !== String(revision))
				return Response.json({ error: 'This composite changed. Reopen it before saving.' });
			if (
				body.action === 'save' &&
				!body.force &&
				checkSvelteSource(body.content).diagnostics.some((item) => item.severity === 'error')
			) {
				return Response.json({ saved: false });
			}
			composite.source = body.action === 'reset' ? undefined : body.content;
			savedSource = composite.source;
			revision += 1;
		}
		return Response.json({
			content: renderCompositeSource(composite),
			composite,
			revision: String(revision),
			saved: body.action !== 'read'
		});
	}
	if (body.action === 'list')
		return Response.json({
			files: [{ path: 'nested/ProjectCard.svelte', size: 100 }],
			widgets: [{ name: 'WidgetButton', modified: false }]
		});
	return Response.json({ content: '<p>Other mode</p>' });
}

beforeEach(() => {
	revision = 1;
	savedSource = undefined;
	definitions = [
		{ id: 'hero', name: 'HeroComposite', width: 600, height: 200, blocks: [], source: original },
		{ id: 'second', name: 'SecondaryComposite', width: 400, height: 200, blocks: [] }
	];
	vi.stubGlobal('fetch', vi.fn(memoryFetch));
	vi.stubGlobal(
		'confirm',
		vi.fn(() => true)
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('native composite code editor route', () => {
	it('places one Find below three mode tabs and filters names/paths with distinct empty states', async () => {
		render(ComponentEditorPage);
		await expect.element(page.getByRole('tab', { name: 'Composites', exact: true })).toBeVisible();
		expect(document.querySelectorAll('#ce-filter')).toHaveLength(1);
		const tabs = document.querySelector('.mode-tabs')!;
		const find = document.querySelector('#ce-filter')!;
		expect(tabs.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		await page.getByRole('searchbox', { name: 'Find', exact: true }).fill('NESTED/');
		await expect
			.element(page.getByRole('button', { name: 'ProjectCard.svelte nested/' }))
			.toBeVisible();
		await page.getByRole('searchbox', { name: 'Find', exact: true }).fill('absent');
		await expect.element(page.getByText('No match.', { exact: true })).toBeVisible();
		await page.getByRole('tab', { name: 'Built-in widgets' }).click();
		await expect.element(page.getByText('No match.', { exact: true })).toBeVisible();
		await page.getByRole('searchbox', { name: 'Find', exact: true }).fill('widgetBUTTON');
		await expect
			.element(page.getByRole('button', { name: 'WidgetButton', exact: true }))
			.toBeVisible();
		await page.getByRole('tab', { name: 'Composites', exact: true }).click();
		await expect.element(page.getByText('No match.', { exact: true })).toBeVisible();
		await page.getByRole('searchbox', { name: 'Find', exact: true }).fill('HEROCOMPOSITE.SVELTE');
		await expect.element(page.getByRole('button', { name: 'HeroComposite edited' })).toBeVisible();
		expect(document.querySelectorAll('ul[aria-label="Composites"] li')).toHaveLength(1);
		definitions = [];
		await page.getByRole('tab', { name: 'Project', exact: true }).click();
		await page.getByRole('tab', { name: 'Composites', exact: true }).click();
		await expect.element(page.getByText('No composites yet.', { exact: false })).toBeVisible();
	});

	it('edits all native parts, previews source/styles, saves and reopens exact assembled text, then resets', async () => {
		render(ComponentEditorPage);
		await page.getByRole('tab', { name: 'Composites', exact: true }).click();
		await page.getByRole('button', { name: 'HeroComposite edited' }).click();
		await expect
			.poll(() => document.querySelector('.composite-source-preview')?.textContent)
			.toContain('Original composite');
		await edit('Component script', "let title = $state('Edited native preview');");
		await edit('Component markup', '<h3 class="native">{title}</h3>');
		await edit('Component style', '.native { color: rgb(44, 55, 66); }');
		await expect
			.poll(() => document.querySelector('.composite-source-preview')?.textContent)
			.toContain('Edited native preview');
		await expect
			.poll(() => {
				const node = document.querySelector('.composite-source-preview h3');
				return node ? getComputedStyle(node).color : '';
			})
			.toBe('rgb(44, 55, 66)');
		const parts = [
			editor('Component script').state.doc.toString(),
			editor('Component markup').state.doc.toString(),
			editor('Component style').state.doc.toString()
		];
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.poll(() => savedSource).toContain('<h3 class="native">{title}</h3>');
		const exact = savedSource;
		await page.getByRole('button', { name: 'SecondaryComposite', exact: true }).click();
		await page.getByRole('button', { name: 'HeroComposite edited' }).click();
		expect([
			editor('Component script').state.doc.toString(),
			editor('Component markup').state.doc.toString(),
			editor('Component style').state.doc.toString()
		]).toEqual(parts);
		expect(definitions[0].source).toBe(exact);
		await page.getByRole('button', { name: 'Reset to generated source' }).click();
		await expect
			.poll(() => editor('Component markup').state.doc.toString())
			.toContain('data-editor-composite="HeroComposite"');
		expect(definitions[0].source).toBeUndefined();
	});

	it('confirms unsaved mode switching and prevents stale reads or compiler failures from replacing edits', async () => {
		render(ComponentEditorPage);
		await page.getByRole('tab', { name: 'Composites', exact: true }).click();
		await page.getByRole('button', { name: 'HeroComposite edited' }).click();
		await edit('Component script', 'let = ;');
		await expect.poll(() => document.querySelector('.count-pill.bad')?.textContent).toBeTruthy();
		vi.mocked(confirm).mockReturnValue(false);
		await page.getByRole('tab', { name: 'Project', exact: true }).click();
		await expect
			.element(page.getByRole('tab', { name: 'Composites', exact: true }))
			.toHaveAttribute('aria-selected', 'true');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.element(page.getByRole('button', { name: 'Save anyway' })).toBeVisible();
		expect(savedSource).toBeUndefined();
		vi.mocked(confirm).mockReturnValue(true);
		let resolveRead!: (value: Response) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn((url, init) => {
				const body = JSON.parse(String(init?.body ?? '{}'));
				if (String(url) === '/component-editor/composites' && body.action === 'read') {
					return new Promise<Response>((resolve) => {
						resolveRead = resolve;
					});
				}
				return memoryFetch(url, init);
			})
		);
		await page.getByRole('button', { name: 'SecondaryComposite', exact: true }).click();
		await page.getByRole('tab', { name: 'Project', exact: true }).click();
		resolveRead(
			Response.json({ content: '<p>STALE RESPONSE</p>', composite: definitions[1], revision: '2' })
		);
		await tick();
		expect(document.querySelector('.cm-content[aria-label="Component markup"]')).toBeNull();
		expect(document.body.textContent).not.toContain('STALE RESPONSE');
	});
});
