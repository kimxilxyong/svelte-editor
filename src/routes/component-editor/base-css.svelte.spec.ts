/**
 * @fileoverview Real route interactions for Base CSS with isolated in-memory API
 * responses. Both source modes run the real generator and CodeMirror, but no
 * server, database, saved project file or widget override can be mutated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { EditorView } from '@codemirror/view';
import { tick } from 'svelte';
import '../layout.css';
import ComponentEditorPage from './+page.svelte';

vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	invalidateAll: vi.fn(),
	goto: vi.fn()
}));
vi.mock('$app/state', () => ({
	page: { data: { project: { id: 'test-only', path: '/test-only' } } }
}));

const initialCss = '/* handwritten; keep verbatim */\n#owned { color: red; }\n';
const content = `<script lang="ts">let title = 'Example';</script>
	<p id="owned">{title}</p><button class="rounded-lg p-4">Save</button>
	<style>${initialCss}</style>`;

/** Returns the actual editor document, including text outside CodeMirror's viewport. */
function editor(label: string): EditorView {
	const element = document.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);
	if (!element) throw new Error(`Missing ${label}`);
	const view = EditorView.findFromDOM(element);
	if (!view) throw new Error(`Missing editor view for ${label}`);
	return view;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Component editor Base CSS', () => {
	it.each(['project', 'widgets'] as const)(
		'generates, preserves CSS and undoes/redoes in %s mode without saving',
		async (mode) => {
			const actions: string[] = [];
			const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as { action?: string };
				actions.push(body.action ?? '');
				if (body.action === 'list') {
					return Response.json({
						root: '/test-only',
						files: [{ path: 'Sample.svelte', size: content.length }],
						widgets: [{ name: 'Sample', modified: false }]
					});
				}
				if (body.action === 'read') return Response.json({ content });
				throw new Error(`Unexpected request: ${body.action}`);
			});
			vi.stubGlobal('fetch', fetchMock);
			render(ComponentEditorPage);
			if (mode === 'widgets') await page.getByRole('tab', { name: 'Built-in widgets' }).click();
			await page.getByRole('button', { name: 'Sample', exact: mode === 'widgets' }).click();
			await expect
				.poll(() => editor('Component style').state.doc.toString())
				.toContain('handwritten');
			const before = editor('Component style').state.doc.toString();
			await page.getByRole('button', { name: 'Generate Base CSS', exact: true }).click();
			await expect
				.poll(() => editor('Component style').state.doc.toString())
				.toContain('@layer base');
			const generated = editor('Component style').state.doc.toString();
			expect(generated.startsWith(before)).toBe(true);
			expect(generated).toContain('.p-4.rounded-lg');
			expect(generated.match(/#owned\s*\{/g)?.length).toBe(1);
			expect(actions).not.toContain('save');
			if (mode === 'project') {
				for (const width of [1440, 390]) {
					await page.viewport(width, 900);
					const button = page
						.getByRole('button', { name: 'Generate Base CSS', exact: true })
						.element();
					button.scrollIntoView({ block: 'center' });
					const box = button.getBoundingClientRect();
					const header = button.closest('header')!.getBoundingClientRect();
					expect(box.left).toBeGreaterThanOrEqual(header.left);
					expect(box.right).toBeLessThanOrEqual(header.right);
					expect(box.right).toBeLessThanOrEqual(width);
				}
				await page.viewport(1280, 720);
			}
			await page.getByRole('button', { name: 'Undo', exact: true }).click();
			await tick();
			expect(editor('Component style').state.doc.toString()).toBe(before);
			await page.getByRole('button', { name: 'Redo', exact: true }).click();
			await tick();
			expect(editor('Component style').state.doc.toString()).toBe(generated);
			await page.getByRole('button', { name: 'Generate Base CSS', exact: true }).click();
			await expect
				.poll(() => document.querySelector('.save-status')?.textContent)
				.toContain('No new Base CSS');
			expect(editor('Component style').state.doc.toString()).toBe(generated);
			expect(actions).not.toContain('save');
		}
	);

	it('shows unsupported-markup errors in status and leaves Style untouched', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as { action: string };
				return Response.json(
					body.action === 'list'
						? { files: [{ path: 'Bad.svelte', size: 10 }] }
						: { content: '<Button /><style>/* retained */</style>' }
				);
			})
		);
		render(ComponentEditorPage);
		await page.getByRole('button', { name: 'Bad.svelte' }).click();
		const before = editor('Component style').state.doc.toString();
		await page.getByRole('button', { name: 'Generate Base CSS', exact: true }).click();
		await expect
			.poll(() => document.querySelector('.save-status')?.textContent)
			.toContain('No static native elements');
		expect(editor('Component style').state.doc.toString()).toBe(before);
	});

	it('discards an in-flight sample after editing and keeps Save disabled while sampling', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as { action: string };
				return Response.json(
					body.action === 'list'
						? { files: [{ path: 'Sample.svelte', size: content.length }] }
						: { content }
				);
			})
		);
		render(ComponentEditorPage);
		await page.getByRole('button', { name: 'Sample.svelte' }).click();
		const view = editor('Component style');
		view.dispatch({ changes: { from: view.state.doc.length, insert: '\n/* unsaved */' } });
		await tick();
		await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
		const before = view.state.doc.toString();
		const append = document.body.append.bind(document.body);
		let sampler: HTMLIFrameElement | undefined;
		// Hold only the sampler's connection to the DOM, not the editor or generator.
		vi.spyOn(document.body, 'append').mockImplementation((...nodes) => {
			if (nodes[0] instanceof HTMLIFrameElement && 'baseCssSampler' in nodes[0].dataset) {
				sampler = nodes[0];
			} else append(...nodes);
		});
		await page.getByRole('button', { name: 'Generate Base CSS', exact: true }).click();
		await expect.poll(() => sampler).toBeDefined();
		await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		const suffix = '\n/* edit while waiting */';
		view.dispatch({ changes: { from: view.state.doc.length, insert: suffix } });
		await tick();
		if (!sampler) throw new Error('Sampler was not created');
		append(sampler);
		await expect
			.poll(() => document.querySelector('.save-status')?.textContent)
			.toContain('discarded');
		expect(view.state.doc.toString()).toBe(before + suffix);
		expect(document.querySelector('[data-base-css-sampler]')).toBeNull();
	});
});
