/**
 * @fileoverview Unit tests for the section split/join logic and the compiler-based diagnostics.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	distributeDiagnostics,
	joinSvelteSource,
	mapSourcePosition,
	newComponentSource,
	splitSvelteSource
} from './svelte-sections.js';
import { checkSvelteSource } from './svelte-diagnostics.js';

const TS_SOURCE = `<script lang="ts">
	let { title = 'Hi' }: { title?: string } = $props();
</script>

<h1>{title}</h1>

<style>
	h1 {
		color: red;
	}
</style>
`;

describe('splitSvelteSource', () => {
	it('splits script, markup and style and removes indentation', () => {
		const { sections, notes } = splitSvelteSource(TS_SOURCE);
		expect(notes).toEqual([]);
		expect(sections.scriptLang).toBe('ts');
		expect(sections.script).toBe("let { title = 'Hi' }: { title?: string } = $props();");
		expect(sections.markup).toBe('<h1>{title}</h1>');
		expect(sections.style).toBe('h1 {\n\tcolor: red;\n}');
		expect(sections.scriptIndent).toBe('\t');
	});

	it('detects plain JavaScript and module scripts and keeps extra attributes', () => {
		const { sections } = splitSvelteSource(
			'<script module>\n\texport const x = 1;\n</script>\n<script generics="T">\n\tlet a = 1;\n</script>\n<p>x</p>'
		);
		expect(sections.moduleScript).toBe('export const x = 1;');
		expect(sections.scriptLang).toBe('js');
		expect(sections.scriptAttrs).toBe('generics="T"');
	});

	it('keeps nested scripts in the markup and handles files without blocks', () => {
		const { sections } = splitSvelteSource(
			'<svelte:head><script>1</script></svelte:head>\n<p>a</p>'
		);
		expect(sections.script).toBe('');
		expect(sections.markup).toContain('<svelte:head>');
	});

	it('still splits a file that does not parse', () => {
		const { sections } = splitSvelteSource('<script>\n\tlet a = ;\n</script>\n<p>{</p>');
		expect(sections.script).toBe('let a = ;');
		expect(sections.markup).toBe('<p>{</p>');
	});
});

describe('joinSvelteSource', () => {
	it('round-trips a typical file exactly', () => {
		const { sections } = splitSvelteSource(TS_SOURCE);
		expect(joinSvelteSource(sections).source).toBe(TS_SOURCE);
	});

	it('round-trips every bundled component to a stable fixed point', () => {
		const dir = join(import.meta.dirname, 'components/editor');
		for (const name of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const original = readFileSync(join(dir, name), 'utf8');
			const once = joinSvelteSource(splitSvelteSource(original).sections).source;
			const twice = joinSvelteSource(splitSvelteSource(once).sections).source;
			expect(twice, name).toBe(once);
			// Joining must not change the compile result.
			expect(checkSvelteSource(once).ok, name).toBe(checkSvelteSource(original).ok);
		}
	});

	it('omits empty blocks and creates a TS script tag for new components', () => {
		const source = newComponentSource('ts');
		expect(source.startsWith('<script lang="ts">')).toBe(true);
		expect(checkSvelteSource(source).ok).toBe(true);
		expect(newComponentSource('js')).not.toContain('lang=');
	});
});

describe('diagnostic mapping', () => {
	it('maps whole-file positions back into section editors', () => {
		const { sections } = splitSvelteSource(TS_SOURCE);
		const { source, map } = joinSvelteSource(sections);
		expect(source).toBe(TS_SOURCE);
		// Line 2 col 1 is the first char after the tab -> script line 1 col 0.
		expect(mapSourcePosition(map, 2, 1)).toEqual({ section: 'script', line: 1, column: 0 });
		expect(mapSourcePosition(map, 5, 4)?.section).toBe('markup');
		expect(mapSourcePosition(map, 9, 2)).toEqual({ section: 'style', line: 2, column: 1 });
	});

	it('routes compiler errors to the right section', () => {
		const { sections } = splitSvelteSource('<script>\n\tlet a = 1;\n</script>\n\n<p>{</p>');
		sections.markup = '<div>\n\t{#if a}\n</div>';
		const { source, map } = joinSvelteSource(sections);
		const result = checkSvelteSource(source);
		expect(result.ok).toBe(false);
		const grouped = distributeDiagnostics(result.diagnostics, map);
		expect(grouped.markup.length).toBeGreaterThan(0);
		expect(grouped.script).toEqual([]);
	});
});

describe('checkSvelteSource', () => {
	it('accepts valid TypeScript components', () => {
		expect(checkSvelteSource(TS_SOURCE).ok).toBe(true);
	});

	it('reports syntax errors with a location', () => {
		const { ok, diagnostics } = checkSvelteSource('<script>\n\tlet = ;\n</script>');
		expect(ok).toBe(false);
		expect(diagnostics[0].severity).toBe('error');
		expect(diagnostics[0].line).toBeGreaterThan(0);
	});

	it('reports warnings without failing', () => {
		const { ok, diagnostics } = checkSvelteSource(
			'<img src="a.png">\n<style>.nope{color:red}</style>'
		);
		expect(ok).toBe(true);
		expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
	});
});
