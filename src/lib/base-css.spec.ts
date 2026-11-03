/**
 * @fileoverview Pure AST regression tests for safe Base CSS extraction and
 * append ownership. Tests never evaluate component code or touch the filesystem.
 */
import { describe, expect, it } from 'vitest';
import { existingBaseCssSelectors, extractBaseCssElements } from './base-css.js';

describe('Base CSS static extraction', () => {
	it('keeps literal IDs, complete class fragments and useful safe attributes only', () => {
		const plan = extractBaseCssElements(`
			<script>throw new Error('must never run'); let size = 'lg';</script>
			<button id="save" class="btn-{size} px-4 {size} rounded-lg" type="button"
				style="color: red" onclick={() => alert('no')} data-mode="save">Save</button>
			<img src="https://invalid.example/no" srcset="https://invalid.example/no 2x" />
		`);
		expect(plan.elements[0]).toMatchObject({
			tag: 'button',
			attributes: { id: 'save', class: 'px-4 rounded-lg', type: 'button', 'data-mode': 'save' },
			text: 'Save'
		});
		expect(plan.elements[0].attributes).not.toHaveProperty('style');
		expect(plan.elements[0].attributes).not.toHaveProperty('onclick');
		expect(plan.elements[1].attributes).toEqual({});
		expect(plan.warnings.join(' ')).toContain('not evaluated');
	});

	it('takes static representatives of blocks without calling expressions or imported components', () => {
		const plan = extractBaseCssElements(`
			{#if dangerous()}<h2>A</h2>{:else}<p>B</p>{/if}
			{#each fetchData() as row}<article>{row}</article>{:else}<aside>Empty</aside>{/each}
			{#await promise}<span>Wait</span>{:then value}<strong>{value}</strong>{:catch}<em>Error</em>{/await}
			<Button><div class="unknown-slot">Ignored</div></Button>
			<custom-widget /><iframe src="https://invalid.example" />
			{@html unsafe}{#snippet content()}<footer>Unused</footer>{/snippet}
		`);
		expect(plan.elements.map((el) => el.tag)).toEqual([
			'h2',
			'p',
			'article',
			'aside',
			'span',
			'strong',
			'em'
		]);
		expect(plan.warnings.length).toBeGreaterThan(1);
	});

	it('fails explicitly on malformed source and excessive static markup', () => {
		expect(() => extractBaseCssElements('<div>')).toThrow();
		expect(() => extractBaseCssElements('<div></div>'.repeat(501))).toThrow('500');
	});
});

describe('Base CSS selector ownership', () => {
	it('reads grouped, nested, conditional and global selectors with the CSS AST', () => {
		const names = existingBaseCssSelectors(`
			/* .not-a-selector {} */
			.a, :global(#save) { color: red; &.active { color: blue } }
			:global { .external { color: green } }
			@media (width > 20rem) { p, .conditional { color: purple } }
			@layer utilities { .outer { .child { color: black } } }
			:global(.first, .second) { opacity: 1; }
			.rounded-lg.p-4 { padding: 1rem; }
		`);
		expect([...names]).toEqual(
			expect.arrayContaining([
				'.a',
				'#save',
				'.a.active',
				'#save.active',
				'.external',
				'p',
				'.conditional',
				'.outer .child',
				'.first',
				'.second',
				'.p-4.rounded-lg'
			])
		);
		expect(names.has('.child')).toBe(false);
		expect(names.has('.not-a-selector')).toBe(false);
	});

	it('normalizes escaped identifiers without confusing strings and selectors', () => {
		const names = existingBaseCssSelectors(String.raw`
			.\66 oo, .w-1\/2 { content: ".fake {}"; }
			[data-label=".other"] { color: red; }
		`);
		expect(names.has('.foo')).toBe(true);
		expect(names.has('.w-1/2')).toBe(true);
		expect(names.has('.fake')).toBe(false);
		expect(names.has('.other')).toBe(false);
		expect(() => existingBaseCssSelectors('.bad {')).toThrow();
	});
});
