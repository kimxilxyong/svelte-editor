/**
 * @fileoverview Real-browser regression tests for CodeEditorApi.append and
 * pointer-driven class hovers against the application's loaded Tailwind/Flowbite
 * CSS. Includes live language reconfiguration and stale-tooltip dismissal.
 * Exercises the bound value, normal onchange listener, preserved selection, isolated
 * undo/redo on both sides of adjacent typing, and the empty-append no-op.
 * Mounts only a component harness; no routes, saved source or databases are touched.
 * Completion regressions use actual Ctrl+Space/Enter/Escape input and the rendered
 * popup; paired-input tests exercise browser input handlers, not command proxies.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { Transaction } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import {
	currentCompletions,
	completionStatus,
	selectedCompletionIndex,
	setSelectedCompletion
} from '@codemirror/autocomplete';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { CodeEditorApi } from './CodeEditor.svelte';
import CodeEditor from './CodeEditor.svelte';
import CodeEditorAppendHarness from './testing/CodeEditorAppendHarness.svelte';

/** Positions the real editor cursor at a marked UTF-16 offset. */
function place(view: EditorView, marked: string) {
	const pos = marked.indexOf('|');
	view.dispatch({
		changes: { from: 0, to: view.state.doc.length, insert: marked.replace('|', '') },
		selection: { anchor: pos }
	});
	view.focus();
}

/** Discovers options with the documented keyboard shortcut, then selects one. */
async function discover(view: EditorView, label: string) {
	await userEvent.keyboard('{Control>}{Space}{/Control}');
	await vi.waitFor(() =>
		expect(currentCompletions(view.state).map((item) => item.label)).toContain(label)
	);
	expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeNull();
	const index = currentCompletions(view.state).findIndex((item) => item.label === label);
	view.dispatch({ effects: setSelectedCompletion(index) });
	expect(selectedCompletionIndex(view.state)).toBe(index);
	// CodeMirror deliberately suppresses acceptance briefly after showing a menu.
	await new Promise((resolve) => setTimeout(resolve, 100));
	await userEvent.keyboard('{ArrowDown}{ArrowUp}');
	expect(selectedCompletionIndex(view.state)).toBe(index);
}

describe('CodeEditor autocomplete and paired input', () => {
	it('keeps native HTML tags/attributes and CSS property/value completion after language switches', async () => {
		const { container, rerender } = render(CodeEditor, {
			value: '',
			language: 'html',
			ariaLabel: 'Completion source'
		});
		const surface = container.querySelector<HTMLElement>('.cm-content')!;
		const view = EditorView.findFromDOM(surface)!;
		for (const language of ['html', 'svelte'] as const) {
			await rerender({ language });
			place(view, '<di|>');
			await discover(view, 'div');
			await userEvent.keyboard('{Enter}');
			expect(view.state.doc.toString()).toBe('<div>');
			place(view, '<button tit|></button>');
			await discover(view, 'title');
			await userEvent.keyboard('{Escape}');
			expect(completionStatus(view.state)).toBeNull();
		}
		await rerender({ language: 'css' });
		expect(EditorView.findFromDOM(surface)).toBe(view);
		place(view, '.example { col| }');
		await discover(view, 'color');
		await userEvent.keyboard('{Enter}');
		expect(view.state.doc.toString()).toContain('color');
		place(view, '.example { display: fl| }');
		await discover(view, 'flex');
		await userEvent.keyboard('{Enter}');
		expect(view.state.doc.toString()).toBe('.example { display: flex }');
		await rerender({ language: 'svelte' });
		place(view, '<style>.example { disp| }</style>');
		await discover(view, 'display');
		await userEvent.keyboard('{Escape}');
	});

	it('offers loaded/local classes with previews, preserves replacement suffixes and undo/redo, and never fetches', async () => {
		const { container, rerender } = render(CodeEditor, {
			value: '',
			language: 'svelte',
			ariaLabel: 'Class completion source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		const fetch = vi.spyOn(window, 'fetch');
		const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
		try {
			place(view, '<div class="h-f|ulx"></div>');
			await discover(view, 'h-full');
			expect(
				currentCompletions(view.state).find((item) => item.label === 'h-full')?.info
			).toContain('height: 100%');
			await userEvent.keyboard('{Enter}');
			const accepted = '<div class="h-full"></div>';
			expect(view.state.doc.toString()).toBe(accepted);
			expect(undo(view)).toBe(true);
			expect(view.state.doc.toString()).toBe('<div class="h-fulx"></div>');
			expect(redo(view)).toBe(true);
			expect(view.state.doc.toString()).toBe(accepted);
			for (const name of [
				'md:flex',
				'hover:bg-primary-600',
				'w-1/2',
				'bg-[#123456]',
				'bg-primary-600'
			]) {
				place(view, `<div class="${name.slice(0, 3)}|"></div>`);
				await discover(view, name);
				await userEvent.keyboard('{Enter}');
				expect(view.state.doc.toString()).toBe(`<div class="${name}"></div>`);
			}
			place(view, '<style>.local-card { color: red }</style><div class="local-|"></div>');
			await discover(view, 'local-card');
			expect(
				currentCompletions(view.state).find((item) => item.label === 'local-card')?.detail
			).toBe('Document class');
			await userEvent.keyboard('{Enter}');
			await rerender({ language: 'css' });
			place(view, '.w-|1\\/x {}');
			await discover(view, 'w-1/2');
			await userEvent.keyboard('{Enter}');
			expect(view.state.doc.toString()).toBe('.w-1\\/2 {}');
			await rerender({ language: 'html' });
			place(view, '<div class="h-f|"></div>');
			await discover(view, 'h-full');
			await rerender({ language: 'javascript' });
			await vi.waitFor(() =>
				expect(currentCompletions(view.state).some((item) => item.type === 'class')).toBe(false)
			);
			place(view, 'const text = "h-f|";');
			await userEvent.keyboard('{Control>}{Space}{/Control}');
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(currentCompletions(view.state).some((item) => item.type === 'class')).toBe(false);
			await rerender({ language: 'svelte' });
			for (const source of [
				'<!-- class="h-f|" -->',
				'<script>const text = "h-f|"</script>',
				'<div class="bg-|{color}"/>'
			]) {
				place(view, source);
				await userEvent.keyboard('{Control>}{Space}{/Control}');
				await new Promise((resolve) => setTimeout(resolve, 150));
				expect(currentCompletions(view.state).some((item) => item.type === 'class')).toBe(false);
			}
			expect(fetch).not.toHaveBeenCalled();
			expect(xhr).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
			xhr.mockRestore();
		}
	});

	it('opens class suggestions while typing and discovers classes in an empty attribute', async () => {
		const { container } = render(CodeEditor, {
			value: '<div class=""></div>',
			language: 'html',
			ariaLabel: 'Automatic completion'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		place(view, '<div class="|"></div>');
		await discover(view, 'h-full');
		await userEvent.keyboard('{Escape}');
		await userEvent.type(view.contentDOM, 'h-f');
		await vi.waitFor(() =>
			expect(currentCompletions(view.state).map((item) => item.label)).toContain('h-full')
		);
	});

	it('completes local script functions and native snippets, plus Svelte-only rune snippets with Tab fields', async () => {
		const { container, rerender } = render(CodeEditor, {
			value: '',
			language: 'javascript',
			ariaLabel: 'Script completion source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		for (const language of ['javascript', 'typescript', 'svelte'] as const) {
			await rerender({ language });
			const script = 'function greet(name) { return name; }\nconst localArrow = () => 1;\ngre|';
			place(view, language === 'svelte' ? `<script>${script}</script>` : script);
			await discover(view, 'greet');
			await userEvent.keyboard('{Enter}');
			expect(view.state.doc.toString()).toContain('\ngreet');
			const arrow = 'const localArrow = () => 1;\nlocalA|';
			place(view, language === 'svelte' ? `<script>${arrow}</script>` : arrow);
			await discover(view, 'localArrow');
			await userEvent.keyboard('{Enter}');
			expect(view.state.doc.toString()).toContain('\nlocalArrow');
			place(view, language === 'svelte' ? '<script>fun|</script>' : 'fun|');
			await discover(view, 'function');
			await userEvent.keyboard('{Escape}');
		}
		place(view, '<script>let count = $sta|;</script>');
		await discover(view, '$state');
		await userEvent.keyboard('{Enter}');
		expect(view.state.doc.toString()).toContain('$state(initial)');
		await userEvent.keyboard('0{Tab}');
		expect(view.state.doc.toString()).toContain('$state(0)');
		place(view, '<script>// $sta|\n</script>');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(currentCompletions(view.state).map((item) => item.label)).not.toContain('$state');
		await rerender({ language: 'typescript' });
		place(view, '$sta|');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(currentCompletions(view.state).map((item) => item.label)).not.toContain('$state');
	});

	it('pairs brackets/quotes, skips existing closers and closes HTML/Svelte tags via actual typing', async () => {
		const { container, rerender } = render(CodeEditor, {
			value: '',
			language: 'javascript',
			ariaLabel: 'Paired source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		for (const [open, close] of [
			['(', ')'],
			['[', ']'],
			['{', '}'],
			['"', '"'],
			["'", "'"]
		]) {
			place(view, '|');
			await userEvent.type(view.contentDOM, open === '[' ? '[[' : open === '{' ? '{{' : open);
			expect(view.state.doc.toString()).toBe(open + close);
			expect(view.state.selection.main.head).toBe(1);
			await userEvent.type(view.contentDOM, close);
			expect(view.state.doc.toString()).toBe(open + close);
			expect(view.state.selection.main.head).toBe(2);
		}
		for (const language of ['html', 'svelte'] as const) {
			await rerender({ language });
			place(view, '<section|');
			await userEvent.type(view.contentDOM, '>');
			expect(view.state.doc.toString()).toBe('<section></section>');
			expect(view.state.selection.main.head).toBe('<section>'.length);
		}
		place(view, '<script>const x = |;</script>');
		await userEvent.type(view.contentDOM, '(');
		expect(view.state.doc.toString()).toBe('<script>const x = ();</script>');
	});
});

/** Moves a real Playwright pointer to a document offset, not a hover-source proxy. */
async function pointAt(view: EditorView, text: string) {
	const from = view.state.doc.toString().indexOf(text);
	expect(from).toBeGreaterThanOrEqual(0);
	const pos = from + Math.floor(text.length / 2);
	view.dispatch({ effects: EditorView.scrollIntoView(pos) });
	await vi.waitFor(() => {
		const coords = view.coordsAtPos(pos)!;
		expect(coords).not.toBeNull();
		expect(coords.left).toBeGreaterThanOrEqual(0);
		expect(coords.left).toBeLessThan(window.innerWidth - 3);
	});
	const coords = view.coordsAtPos(pos)!;
	// Target the fixed viewport, not the wide content element: Playwright would
	// otherwise auto-center that element and undo CodeMirror's horizontal scroll.
	const content = view.scrollDOM;
	const bounds = content.getBoundingClientRect();
	await userEvent.hover(document.body, { position: { x: 1, y: 1 }, force: true });
	await userEvent.hover(content, {
		position: {
			x: coords.left - bounds.left + 2,
			y: (coords.top + coords.bottom) / 2 - bounds.top
		},
		force: true
	});
}

/** Reads the actual tooltip DOM after CodeMirror's dwell timer. */
async function tooltip(view: EditorView, text: string) {
	await pointAt(view, text);
	await vi.waitFor(
		() => expect(document.querySelector('.cm-class-hover > strong')?.textContent).toBe(text),
		{ timeout: 2000 }
	);
	return document.querySelector<HTMLElement>('.cm-class-hover')!;
}

describe('CodeEditor class hover', () => {
	it('shows actual h-full CSS, a useful meaning and resolved Flowbite theme values without requests', async () => {
		const { container, rerender } = await render(CodeEditor, {
			value: '<div class="h-full bg-primary-600"></div>',
			language: 'svelte',
			readonly: true,
			ariaLabel: 'Hover source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		const fetch = vi.spyOn(window, 'fetch');
		const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
		try {
			let tip = await tooltip(view, 'h-full');
			expect(tip.textContent).toContain('height: 100%');
			expect(tip.textContent).toContain('parent needs a definite height');
			expect(tip.textContent).toContain('Source:');
			expect(tip.textContent).toContain('Actual loaded CSS');
			expect(tip.querySelector('a')?.href).toBe(
				'https://developer.mozilla.org/en-US/docs/Web/CSS/height'
			);
			tip = await tooltip(view, 'bg-primary-600');
			expect(tip.textContent).toContain('background-color: var(--color-primary-600)');
			expect(tip.textContent).toContain('--color-primary-600: #7c3aed');
			expect(tip.textContent).toContain('editor context');
			expect(fetch).not.toHaveBeenCalled();
			expect(xhr).not.toHaveBeenCalled();
			await rerender({ theme: 'dark' });
			tip = await tooltip(view, 'h-full');
			const pre = tip.querySelector('pre')!;
			expect(getComputedStyle(pre).color).toBe(getComputedStyle(tip).color);
			expect(tip.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
			expect(getComputedStyle(tip).overflowY).toBe('auto');
			await page.viewport(360, 640);
			tip = await tooltip(view, 'h-full');
			expect(tip.getBoundingClientRect().width).toBeLessThanOrEqual(360);
			expect(tip.getBoundingClientRect().height).toBeLessThanOrEqual(640 * 0.65 + 1);
		} finally {
			fetch.mockRestore();
			xhr.mockRestore();
			await page.viewport(1280, 720);
		}
	});

	it('explains directives, supports CSS selector escapes and surfaces blocked stylesheets', async () => {
		const { container, rerender } = await render(CodeEditor, {
			value: '<div class:h-full={ok}></div>',
			language: 'svelte',
			readonly: true,
			ariaLabel: 'Directive source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		let tip = await tooltip(view, 'h-full');
		expect(tip.textContent).toContain('Conditional Svelte class');
		expect(tip.textContent).toContain('height: 100%');
		await rerender({ language: 'css', value: '.w-1\\/2 { color: red; }' });
		await pointAt(view, 'w-1\\/2');
		await vi.waitFor(() =>
			expect(document.querySelector('.cm-class-hover > strong')?.textContent).toBe('w-1/2')
		);
		expect(document.querySelector('.cm-class-hover')?.textContent).toContain('width:');
		// Unsaved source CSS is not misrepresented as loaded CSS.
		expect(document.querySelector('.cm-class-hover')?.textContent).not.toContain('color: red');

		const style = document.createElement('style');
		style.textContent = '.unreadable-hover-class { color: red }';
		document.head.append(style);
		Object.defineProperty(style.sheet!, 'cssRules', {
			configurable: true,
			get() {
				throw new DOMException('Denied', 'SecurityError');
			}
		});
		try {
			await rerender({ language: 'html', value: '<div class="unreadable-hover-class"></div>' });
			tip = await tooltip(view, 'unreadable-hover-class');
			expect(tip.textContent).toContain('Cannot read stylesheet');
			expect(tip.textContent).toContain('No directly owned definition');
		} finally {
			style.remove();
		}
	});

	it('keeps variant/arbitrary tokens intact, gives honest missing/dynamic states, and ignores nonclasses', async () => {
		const source = `<script>const text = "h-full";</script>
		<!-- class="flex" -->
		<p title="grid">Text</p>
		<div class="md:flex hover:bg-primary-600 w-1/2 bg-[#123456] no-such-hover-class-9743 bg-{color}"></div>`;
		const { container } = await render(CodeEditor, {
			value: source,
			language: 'svelte',
			ariaLabel: 'Variants source'
		});
		const view = EditorView.findFromDOM(container.querySelector('.cm-content')!)!;
		let tip = await tooltip(view, 'md:flex');
		expect(tip.textContent).toContain('@media');
		expect(tip.textContent).toContain('display: flex');
		tip = await tooltip(view, 'hover:bg-primary-600');
		expect(tip.textContent).toContain(':hover');
		expect(tip.textContent).toContain('(hover: hover)');
		tip = await tooltip(view, 'w-1/2');
		expect(tip.textContent).toContain('width:');
		tip = await tooltip(view, 'bg-[#123456]');
		expect(tip.textContent).toContain('background-color:');
		tip = await tooltip(view, 'no-such-hover-class-9743');
		expect(tip.textContent).toContain('No directly owned definition');
		expect(tip.textContent).not.toContain('Meaning');
		await pointAt(view, 'bg-{color}');
		await vi.waitFor(() =>
			expect(document.querySelector('.cm-class-hover')?.textContent).toContain('Dynamic class')
		);
		expect(document.querySelector('.cm-class-hover')?.textContent).not.toContain(
			'Actual loaded CSS'
		);
		for (const text of ['h-full', 'flex', 'grid']) {
			await pointAt(view, text);
			await new Promise((resolve) => setTimeout(resolve, 450));
			expect(document.querySelector('.cm-class-hover')).toBeNull();
		}
	});

	it('closes stale hovers on edits/language changes while retaining append undo and the live view', async () => {
		let api: CodeEditorApi | undefined;
		const { container, rerender } = await render(CodeEditor, {
			value: '<div class="h-full"></div>',
			language: 'html',
			ariaLabel: 'Switch source',
			api: undefined
		});
		const surface = container.querySelector<HTMLElement>('.cm-content')!;
		const view = EditorView.findFromDOM(surface)!;
		await tooltip(view, 'h-full');
		view.dispatch({
			changes: { from: view.state.doc.length, insert: ' ' },
			selection: { anchor: 2, head: 5 }
		});
		await vi.waitFor(() => expect(document.querySelector('.cm-class-hover')).toBeNull());
		await tooltip(view, 'h-full');
		// Mirror the bound value as the real host does; rerender otherwise resends
		// the initial unbound value and intentionally replaces the document.
		await rerender({ language: 'javascript', value: view.state.doc.toString() });
		expect(document.querySelector('.cm-class-hover')).toBeNull();
		expect(EditorView.findFromDOM(surface)).toBe(view);
		await pointAt(view, 'h-full');
		await new Promise((resolve) => setTimeout(resolve, 450));
		expect(document.querySelector('.cm-class-hover')).toBeNull();
		await rerender({ language: 'svelte', value: view.state.doc.toString() });
		expect(view.state.doc.toString()).toBe('<div class="h-full"></div> ');
		expect(view.state.selection.main.anchor).toBe(2);
		expect(view.state.selection.main.head).toBe(5);
		expect(undo(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('<div class="h-full"></div>');
		expect(redo(view)).toBe(true);
		await tooltip(view, 'h-full');
		// The separate binding harness exercises isolated append undo as before.
		const appended = render(CodeEditorAppendHarness, {
			ready: (mounted: CodeEditorApi) => {
				api = mounted;
			},
			onchange: () => {}
		});

		await vi.waitFor(() => expect(api).toBeDefined());
		const appendView = EditorView.findFromDOM(appended.container.querySelector('.cm-content')!)!;
		api!.append('\n.h-full { height: 100%; }');
		expect(api!.undo()).toBe(true);
		expect(appendView.state.doc.toString()).toBe('/* original */');
	});
});

describe('CodeEditor append', () => {
	it('preserves binding and selection, and isolates generation from typing before and after', async () => {
		let api: CodeEditorApi | undefined;
		const onchange = vi.fn();
		const { container } = render(CodeEditorAppendHarness, {
			ready: (mounted: CodeEditorApi) => {
				api = mounted;
			},
			onchange
		});
		await vi.waitFor(() => expect(api).toBeDefined());
		const surface = container.querySelector<HTMLElement>('.cm-content')!;
		const view = EditorView.findFromDOM(surface)!;
		const bound = container.querySelector('[data-testid="bound-value"]')!;
		const original = '/* original */';
		const typed = `${original}x`;
		const suffix = '\n@layer base {\n  p { color: red; }\n}';

		// Adjacent typing transactions would normally merge into the same history event.
		view.dispatch({
			changes: { from: view.state.doc.length, insert: 'x' },
			selection: { anchor: 2, head: 5 },
			annotations: Transaction.userEvent.of('input.type')
		});
		api!.append(suffix);
		await tick();
		expect(view.state.doc.toString()).toBe(typed + suffix);
		expect(bound.textContent).toBe(typed + suffix);
		expect(onchange).toHaveBeenLastCalledWith(typed + suffix);
		expect(view.state.selection.main.anchor).toBe(2);
		expect(view.state.selection.main.head).toBe(5);

		view.dispatch({
			changes: { from: view.state.doc.length, insert: 'y' },
			annotations: Transaction.userEvent.of('input.type')
		});
		expect(api!.undo()).toBe(true);
		expect(view.state.doc.toString()).toBe(typed + suffix);
		expect(api!.undo()).toBe(true);
		await tick();
		expect(view.state.doc.toString()).toBe(typed);
		expect(bound.textContent).toBe(typed);
		expect(api!.undo()).toBe(true);
		expect(view.state.doc.toString()).toBe(original);
		expect(api!.redo()).toBe(true);
		expect(view.state.doc.toString()).toBe(typed);
		expect(api!.redo()).toBe(true);
		await tick();
		expect(bound.textContent).toBe(typed + suffix);
		expect(api!.redo()).toBe(true);
		expect(view.state.doc.toString()).toBe(typed + suffix + 'y');
	});

	it('does not notify or create a history event for an empty append', async () => {
		let api: CodeEditorApi | undefined;
		const onchange = vi.fn();
		render(CodeEditorAppendHarness, {
			ready: (mounted: CodeEditorApi) => {
				api = mounted;
			},
			onchange
		});
		await vi.waitFor(() => expect(api).toBeDefined());
		api!.append('');
		expect(onchange).not.toHaveBeenCalled();
		expect(api!.undo()).toBe(false);
	});
});
