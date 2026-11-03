/**
 * @fileoverview Real Chromium CSSOM coverage against the application's actual
 * Tailwind/Flowbite stylesheet plus test-owned nested/import/condition fixtures.
 * Exercises cache invalidation without a server, routes or database.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../routes/layout.css';
import { acquireClassCssIndex } from './css-class-info.js';

const cleanups: (() => void)[] = [];

/** Creates an isolated CSS fixture; removed after each test. */
function style(text: string) {
	const element = document.createElement('style');
	element.textContent = text;
	document.head.append(element);
	cleanups.push(() => element.remove());
	return element.sheet!;
}

/** Acquires a lifecycle-owned index and always releases the observer after test. */
function index() {
	const index = acquireClassCssIndex(document);
	cleanups.push(() => index.release());
	return (name: string) => index.lookup(name, document.documentElement);
}

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('loaded class CSS', () => {
	it('reads actual Tailwind declarations and Flowbite theme values', () => {
		const lookup = index();
		expect(
			lookup('h-full').rules.some((rule) =>
				rule.declarations.some((decl) => decl.property === 'height' && decl.value === '100%')
			)
		).toBe(true);
		const bg = lookup('bg-primary-600');
		expect(
			bg.rules.some((rule) =>
				rule.declarations.some(
					(decl) =>
						decl.property === 'background-color' && decl.value === 'var(--color-primary-600)'
				)
			)
		).toBe(true);
		expect(bg.variables).toContainEqual({ name: '--color-primary-600', value: '#7c3aed' });
		expect(lookup('no-such-loaded-class-74390').rules).toEqual([]);
	});

	it('retains authored nesting, layers, media, supports, dark and exact owners', () => {
		style(`@layer hover-test {
			.hover\\:bg-primary-600 { &:hover { @media (hover: hover) { background-color: var(--color-primary-600); } } }
			@media (width >= 48rem) { .md\\:flex { display: flex; } }
			@supports (display: grid) { .supports\\:grid { display: grid; } }
			.dark\\:text-white { &:where(.dark, .dark *) { color: white; } }
			.h-fuller { height: 7px; }
			.ancestor .child:not(.negative):has(.context) { color: red; }
			.nest { &:hover { color: blue; } & .descendant { color: green; } }
			.nested-declarations { color: red; @media (width >= 1px) { color: blue; } color: green; }
			.w-1\\/2, .bg-\\[\\#123456\\] { width: 50%; }
		}`);
		const lookup = index();
		const hover = lookup('hover:bg-primary-600').rules.find((rule) =>
			rule.conditions.includes('@layer hover-test')
		)!;
		expect(hover.selector).toBe('.hover\\:bg-primary-600 → &:hover');
		expect(hover.conditions).toContain('@media (hover: hover)');
		expect(hover.declarations).toContainEqual({
			property: 'background-color',
			value: 'var(--color-primary-600)'
		});
		expect(
			lookup('md:flex').rules.some((rule) => rule.conditions.includes('@media (width >= 48rem)'))
		).toBe(true);
		expect(
			lookup('supports:grid').rules.some((rule) =>
				rule.conditions.includes('@supports (display: grid)')
			)
		).toBe(true);
		expect(
			lookup('dark:text-white').rules.some((rule) =>
				rule.selector.includes('&:where(.dark, .dark *)')
			)
		).toBe(true);
		expect(lookup('ancestor').rules).toEqual([]);
		expect(lookup('negative').rules).toEqual([]);
		expect(lookup('context').rules).toEqual([]);
		expect(lookup('child').rules).toHaveLength(1);
		expect(lookup('nest').rules).toHaveLength(1);
		expect(lookup('nest').rules[0].selector).not.toContain('descendant');
		expect(
			lookup('dark').rules.every((rule) => !rule.selector.includes('.dark\\:text-white'))
		).toBe(true);
		expect(
			lookup('nested-declarations').rules.some(
				(rule) =>
					rule.conditions.includes('@media (width >= 1px)') &&
					rule.declarations.some((decl) => decl.value === 'blue')
			)
		).toBe(true);
		expect(
			lookup('nested-declarations').rules.some((rule) =>
				rule.declarations.some((decl) => decl.value === 'green')
			)
		).toBe(true);
		expect(
			lookup('w-1/2').rules.some((rule) => rule.declarations.some((decl) => decl.value === '50%'))
		).toBe(true);
		expect(
			lookup('bg-[#123456]').rules.some((rule) => rule.conditions.includes('@layer hover-test'))
		).toBe(true);
		expect(lookup('h-full').rules.every((rule) => !rule.selector.includes('h-fuller'))).toBe(true);
	});

	it('traverses readable imports without fetching anything during lookup', async () => {
		const url = URL.createObjectURL(
			new Blob(['.imported-hover-rule { color: purple !important; }'], { type: 'text/css' })
		);
		cleanups.push(() => URL.revokeObjectURL(url));
		const sheet = style(
			`@import url("${url}") layer(imported-hover) supports(display: grid) screen;`
		);
		await vi.waitFor(() =>
			expect((sheet.cssRules[0] as CSSImportRule).styleSheet?.cssRules.length).toBe(1)
		);
		const fetch = vi.spyOn(window, 'fetch');
		try {
			const imported = index()('imported-hover-rule').rules;
			expect(imported).toHaveLength(1);
			expect(imported[0].source).toBe(url);
			expect(imported[0].conditions).toContain('@layer imported-hover');
			expect(imported[0].conditions).toContain('@supports display: grid');
			expect(imported[0].conditions).toContain('@media screen');
			expect(imported[0].declarations).toContainEqual({
				property: 'color',
				value: 'purple !important'
			});
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});

	it('reuses the index between hovers and reads theme variables freshly', async () => {
		const sheet = style(
			':root { --hover-theme: red; } .cached-rule { color: var(--hover-theme); }'
		);
		await Promise.resolve();
		const descriptor = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'cssRules')!;
		const reads = vi.fn(() => descriptor.get!.call(sheet) as CSSRuleList);
		Object.defineProperty(sheet, 'cssRules', { configurable: true, get: reads });
		cleanups.push(() => {
			delete (sheet as unknown as Record<string, unknown>).cssRules;
		});
		const lookup = index();
		const first = lookup('cached-rule');
		const second = lookup('cached-rule');
		expect(second.rules[0]).toBe(first.rules[0]);
		expect(reads).toHaveBeenCalledTimes(1);
		document.documentElement.style.setProperty('--hover-theme', 'blue');
		cleanups.push(() => document.documentElement.style.removeProperty('--hover-theme'));
		expect(lookup('cached-rule').variables).toContainEqual({
			name: '--hover-theme',
			value: 'blue'
		});
		expect(reads).toHaveBeenCalledTimes(1);
	});

	it('invalidates for DOM/HMR and bounded CSSOM edits, adopted and disabled sheets', async () => {
		const sheet = style('.hover-cache { color: red; }');
		const owner = sheet.ownerNode as HTMLStyleElement;
		const lookup = index();
		expect(lookup('hover-cache').rules[0].declarations[0].value).toBe('red');
		owner.textContent = '.hover-cache { color: blue; }';
		await Promise.resolve();
		expect(lookup('hover-cache').rules[0].declarations[0].value).toBe('blue');
		const live = owner.sheet!;
		(live.cssRules[0] as CSSStyleRule).style.setProperty('color', 'green');
		await vi.waitFor(
			() => expect(lookup('hover-cache').rules[0].declarations[0].value).toBe('green'),
			{ timeout: 1800 }
		);
		live.disabled = true;
		expect(lookup('hover-cache').rules[0].conditions).toContain('stylesheet disabled');
		const adopted = new CSSStyleSheet();
		adopted.replaceSync('.adopted-hover { display: flex; }');
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];
		cleanups.push(() => {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
				(sheet) => sheet !== adopted
			);
		});
		expect(lookup('adopted-hover').rules).toHaveLength(1);
	});

	it('reports inaccessible sheets rather than silently claiming complete results', () => {
		const sheet = style('.blocked { color: red; }');
		Object.defineProperty(sheet, 'cssRules', {
			configurable: true,
			get() {
				throw new DOMException('Blocked', 'SecurityError');
			}
		});
		cleanups.push(() => {
			delete (sheet as unknown as Record<string, unknown>).cssRules;
		});
		const result = index()('blocked');
		expect(result.rules).toEqual([]);
		expect(result.warnings.join(' ')).toContain('Cannot read stylesheet');
	});
});
