/**
 * @fileoverview Node regressions for additive, tree-gated completion ranges.
 * All positions are absolute UTF-16 offsets, end-exclusive; no DOM is needed.
 */
import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { svelte } from '@replit/codemirror-lang-svelte';
import {
	classCompletionRange,
	documentClassNames,
	editorCompletionExtension,
	type CompletionLanguage
} from './editor-completions.js';

/** Builds a parsed document and cursor context without mounting an editor. */
function context(text: string, language: CompletionLanguage = 'svelte') {
	const pos = text.indexOf('|');
	const doc = text.replace('|', '');
	const state = EditorState.create({
		doc,
		extensions: [
			language === 'css' ? css() : language === 'html' ? html() : svelte(),
			editorCompletionExtension(language)
		]
	});
	return new CompletionContext(state, pos, true);
}

describe('class completion contexts', () => {
	it('replaces complete variant/arbitrary tokens including their suffix', () => {
		for (const language of ['html', 'svelte'] as const) {
			for (const name of ['md:hover:w-1/2', 'bg-[#123456]', '[&>a]:flex', '!p-4']) {
				const ctx = context(`<div class="${name.slice(0, 3)}|${name.slice(3)}"/>`, language);
				const range = classCompletionRange(ctx, language)!;
				expect(ctx.state.sliceDoc(range.from, range.to)).toBe(name);
				expect(range.css).toBe(false);
			}
			expect(classCompletionRange(context('<div class="|"/>', language), language)).toMatchObject({
				from: 12,
				to: 12
			});
			expect(
				classCompletionRange(context('<div class="flex |"/>', language), language)
			).not.toBeNull();
		}
	});
	it('ignores comments, strings, unrelated attributes and mixed expression fragments', () => {
		for (const source of [
			'<!-- <div class="fl|"/> -->',
			'<script>const text = \'<div class="fl|"/>\';</script>',
			'<div title="fl|"/>',
			'<div class="bg-|{color}"/>',
			"<div class=\"{ok ? 'fl|' : ''}\"/>",
			'<div class:active={fl|}/>'
		])
			expect(classCompletionRange(context(source), 'svelte')).toBeNull();
		expect(classCompletionRange(context('/* .fl| */', 'css'), 'css')).toBeNull();
	});
	it('decodes local selectors and collects only static document classes', () => {
		const ctx = context(`<script>const fake = 'phantom';</script>
<!-- class="comment" --><div class="h-full bg-{color} p-4" class:active={ok}/>
<style>.md\\:w-1\\/2 { color: red }</style><div class="|"/>`);
		expect(documentClassNames(ctx.state, 'svelte').sort()).toEqual([
			'active',
			'h-full',
			'md:w-1/2',
			'p-4'
		]);
		const selector = context('.md\\:w-1\\|/2 {}', 'css');
		expect(classCompletionRange(selector, 'css')?.css).toBe(true);
		expect(classCompletionRange(context('.w-1\\| {}', 'css'), 'css')).not.toBeNull();
		expect(classCompletionRange(context('.| {}', 'css'), 'css')).toMatchObject({ css: true });
	});
	it('retains native HTML and CSS completion language data', () => {
		for (const language of ['html', 'css'] as const) {
			const ctx = context(language === 'css' ? '.x { col| }' : '<di|>', language);
			expect(ctx.state.languageDataAt('autocomplete', ctx.pos).length).toBeGreaterThanOrEqual(3);
		}
	});
});
