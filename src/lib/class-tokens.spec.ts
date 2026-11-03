/**
 * @fileoverview Tree-backed source range and selector ownership regressions.
 * Offsets are UTF-16, end-exclusive. No DOM or guessed utility catalogue is used.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { svelte } from '@replit/codemirror-lang-svelte';
import { classTokenAt, decodeCssIdentifier } from './class-tokens.js';
import { selectorClassOwners } from './css-class-info.js';

/** Builds the same language tree used by the live editor and hovers a source substring. */
function target(source: string, text: string, language: 'html' | 'svelte' | 'css' = 'svelte') {
	const state = EditorState.create({
		doc: source,
		extensions: [language === 'html' ? html() : language === 'css' ? css() : svelte()]
	});
	const from = source.indexOf(text);
	return classTokenAt(state, from + Math.floor(text.length / 2), 1, language);
}

describe('class source tokens', () => {
	it('keeps punctuation and exact sides, without wordAt truncation', () => {
		const names = [
			'h-full',
			'md:hover:w-1/2',
			'w-[calc(100%-1rem)]',
			'[&>a]:bg-red-500',
			'!p-4',
			'bg-[#123456]'
		];
		for (const language of ['svelte', 'html'] as const) {
			for (const name of names) {
				const source = `<div class="${name} flex"></div>`;
				const token = target(source, name, language)!;
				expect(token.name).toBe(name);
				expect(source.slice(token.from, token.to)).toBe(name);
			}
		}
		const source = '<div class="h-full flex"/>';
		const state = EditorState.create({ doc: source, extensions: [svelte()] });
		const from = source.indexOf('h-full');
		expect(classTokenAt(state, from, -1, 'svelte')).toBeNull();
		expect(classTokenAt(state, from, 1, 'svelte')?.name).toBe('h-full');
		expect(classTokenAt(state, from + 6, 1, 'svelte')).toBeNull();
		expect(classTokenAt(state, from + 6, -1, 'svelte')?.name).toBe('h-full');
	});

	it('supports className, unquoted markup, directives and escaped CSS selectors', () => {
		expect(target('<div className="w-1/2"/>', 'w-1/2')?.name).toBe('w-1/2');
		expect(target('<div class=flex></div>', 'flex', 'html')?.name).toBe('flex');
		expect(target('<div class:h-full={ok}/>', 'h-full')).toMatchObject({
			name: 'h-full',
			conditional: true
		});
		expect(target('.md\\:w-1\\/2:hover { color: red }', 'md\\:w-1\\/2', 'css')?.name).toBe(
			'md:w-1/2'
		);
		expect(decodeCssIdentifier('w-\\31 \\/2')).toBe('w-1/2');
	});

	it('ignores text, comments, scripts, unrelated attributes and directive expressions', () => {
		for (const source of [
			'<!-- <div class="h-full"/> -->',
			'<p>h-full</p>',
			'<script>const text = \'<div class="h-full"/>\';</script>',
			'<div title="h-full"/>',
			'<div onclick={() => "h-full"}/>',
			'<div class:active={value === "h-full"}/>'
		])
			expect(target(source, 'h-full')).toBeNull();
		expect(target('/* .h-full */ .x { content: "h-full" }', 'h-full', 'css')).toBeNull();
	});

	it('distinguishes static chunks from interpolated fragments and expressions', () => {
		const source = "<div class=\"h-full bg-{color} {ok ? 'flex' : 'grid'} p-4\"/>";
		expect(target(source, 'h-full')).toMatchObject({ name: 'h-full', dynamic: false });
		expect(target(source, 'p-4')).toMatchObject({ name: 'p-4', dynamic: false });
		expect(target(source, 'bg-')).toMatchObject({ dynamic: true });
		expect(target(source, 'color')).toMatchObject({ dynamic: true });
		expect(target(source, 'flex')).toMatchObject({ dynamic: true });
		expect(target('<div class={classes}/>', 'classes')).toMatchObject({ dynamic: true });
	});
});

describe('selector class ownership', () => {
	it('matches escaped complete identifiers, not substrings or strings', () => {
		expect(selectorClassOwners('.h-fuller, .h-full, .md\\:w-1\\/2, .bg-\\[\\#123456\\]')).toEqual([
			'h-fuller',
			'h-full',
			'md:w-1/2',
			'bg-[#123456]'
		]);
		expect(selectorClassOwners('[class=".h-full"] .child')).toEqual(['child']);
		expect(selectorClassOwners('.w-\\31 \\/2')).toEqual(['w-1/2']);
	});
	it('excludes ancestors, negative and relational contexts; includes positive subjects', () => {
		expect(selectorClassOwners('.group:hover .child:not(.disabled):has(.icon)')).toEqual(['child']);
		expect(selectorClassOwners(':where(.dark, .night) .dark\\:flex')).toEqual(['dark:flex']);
		expect(selectorClassOwners(':is(.one, .two):not(.three)')).toEqual(['one', 'two']);
		expect(selectorClassOwners('.ancestor > :where(.child, .other)')).toEqual(['child', 'other']);
		expect(selectorClassOwners('.dark\\:flex:where(.dark, .dark *)')).toEqual(['dark:flex']);
		expect(selectorClassOwners('&:where(.dark, .dark *)')).toEqual([]);
		expect(selectorClassOwners('.one/* .not-a-class */.two')).toEqual(['one', 'two']);
	});
});
