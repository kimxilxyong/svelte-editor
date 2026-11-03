/**
 * @fileoverview Browser integration tests against the actual global Tailwind /
 * Flowbite build. Sampling is scriptless, append-only and independent of editor
 * inheritance and the component style block; no routes or database are used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCss, compile } from 'svelte/compiler';
import '../routes/layout.css';
import { generateBaseCss } from './base-css.js';

const temporary: HTMLElement[] = [];

/** Adds test-owned global styles (including a custom-property dependency). */
function addStyle(css: string): HTMLStyleElement {
	const style = document.createElement('style');
	style.textContent = css;
	document.head.append(style);
	temporary.push(style);
	return style;
}

/** Reads a generated declaration from the compiler CSS AST, not textual regexes. */
function declaration(css: string, selector: string, property: string): string | undefined {
	const ast = parseCss(css);
	for (const layer of ast.children) {
		if (layer.type !== 'Atrule' || layer.name !== 'layer' || !layer.block) continue;
		for (const rule of layer.block.children) {
			if (rule.type !== 'Rule') continue;
			if (!rule.prelude.children.some((part) => css.slice(part.start, part.end) === selector))
				continue;
			for (const entry of rule.block.children) {
				if (entry.type === 'Declaration' && entry.property === property) return entry.value;
			}
		}
	}
	return undefined;
}

afterEach(() => {
	for (const element of temporary.splice(0)) element.remove();
});

describe('Base CSS browser sampler', () => {
	it('samples real global utilities and variables, never component styles or editor inheritance', async () => {
		addStyle(
			':root { --base-css-test: rgb(17, 34, 51); } .sample-default { color: var(--base-css-test); }'
		);
		const wrapper = document.createElement('div');
		wrapper.style.cssText = 'color:rgb(255,0,0);font-family:monospace;font-size:99px';
		document.body.append(wrapper);
		temporary.push(wrapper);
		const existing = '/* keep exactly */\n#owned { color: hotpink; }\n';
		const source = `<script>throw new Error('not executed')</script>
			<button id="owned">Owned</button>
			<p class="sample-default p-4 bg-primary-600 rounded-lg">Hello</p>
			<h2>Heading</h2>
			<style>.sample-default { color: magenta; padding: 999px; }</style>`;
		const result = await generateBaseCss(source, existing);
		expect(result.css.startsWith(existing)).toBe(true);
		expect(result.added).toBe(2);
		const selector = '.bg-primary-600.p-4.rounded-lg.sample-default';
		expect(declaration(result.css, selector, 'color')).toBe('rgb(17, 34, 51)');
		expect(declaration(result.css, selector, 'padding-top')).toBe('16px');
		expect(declaration(result.css, selector, 'background-color')).toBe('rgb(124, 58, 237)');
		expect(declaration(result.css, 'h2', 'font-size')).toBe('16px');
		expect(declaration(result.css, selector, 'width')).toBeUndefined();
		expect(declaration(result.css, selector, 'height')).toBeUndefined();
		expect(result.css).not.toContain('999px');
		expect(() =>
			compile(
				`<p class="sample-default p-4 bg-primary-600 rounded-lg"></p><h2></h2><style>${result.css}</style>`,
				{ generate: false }
			)
		).not.toThrow();
		const again = await generateBaseCss(source, result.css);
		expect(again.css).toBe(result.css);
		expect(again.added).toBe(0);
		expect(document.querySelector('[data-base-css-sampler]')).toBeNull();
	});

	it('keeps responsive and dark variant values out of the unconditional baseline', async () => {
		addStyle(`.baseline { display: block; color: rgb(1, 2, 3); }
			@media (min-width: 1px) { .md\\:flex { display: flex; } }
			.dark\\:text-white { color: white; }`);
		const result = await generateBaseCss(
			'<div class="baseline md:flex dark:text-white">Hi</div>',
			''
		);
		expect(declaration(result.css, '.baseline', 'display')).toBe('block');
		expect(declaration(result.css, '.baseline', 'color')).toBe('rgb(1, 2, 3)');
		expect(result.css).not.toContain('.md\\:flex');
		expect(result.css).toContain('@layer base');
	});

	it('disambiguates shared class owners, escapes classes and intersects element defaults', async () => {
		addStyle(
			'button.shared { color: red; } a.shared { color: blue; } .different { color: green; }'
		);
		const result = await generateBaseCss(
			`
			<button class="shared">Button</button><a class="shared">Link</a>
			<span class="w-1/2">Escape</span><p>Plain</p><p class="different">Different</p>`,
			''
		);
		expect(declaration(result.css, 'button.shared', 'color')).toBe('rgb(255, 0, 0)');
		expect(declaration(result.css, 'a.shared', 'color')).toBe('rgb(0, 0, 255)');
		expect(result.css).toContain('.w-1\\/2');
		// A bare p rule also matches p.different, so conflicting colors are omitted.
		expect(declaration(result.css, 'p', 'color')).toBeUndefined();
		expect(declaration(result.css, '.different', 'color')).toBe('rgb(0, 128, 0)');
	});

	it('ignores resources, executable markup and raw HTML, and cleans up on errors', async () => {
		const result = await generateBaseCss(
			`
			<script>window.baseCssWasExecuted = true</script>
			<img src="https://invalid.example/no" onload={() => fetch('/no')} />
			<p id="safe">Safe</p>{@html '<script>alert(1)</script>'}
			<Button />`,
			''
		);
		expect(result.added).toBe(2);
		expect(result.css).not.toContain('invalid.example');
		expect(result.warnings.join(' ')).toContain('skipped');
		await expect(generateBaseCss('<Button />', '')).rejects.toThrow('No static native');
		await expect(generateBaseCss('<div></div>', '.bad {')).rejects.toThrow();
		expect(document.querySelector('[data-base-css-sampler]')).toBeNull();
	});

	it('removes its temporary document even if sampling fails after creation', async () => {
		const escape = vi.spyOn(CSS, 'escape').mockImplementation(() => {
			throw new Error('test sampling failure');
		});
		try {
			await expect(generateBaseCss('<p id="sample">Hello</p>', '')).rejects.toThrow(
				'test sampling failure'
			);
			expect(document.querySelector('[data-base-css-sampler]')).toBeNull();
		} finally {
			escape.mockRestore();
		}
	});

	it('reports missing global styles instead of returning guessed or UA-only defaults', async () => {
		const emptyDocument = document.implementation.createHTMLDocument('No styles');
		await expect(generateBaseCss('<p>Hello</p>', '', emptyDocument)).rejects.toThrow(
			'Could not read the loaded global CSS'
		);
		expect(emptyDocument.querySelector('[data-base-css-sampler]')).toBeNull();
	});
});
