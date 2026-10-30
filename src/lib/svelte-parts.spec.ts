/**
 * @fileoverview Unit tests for the part split/join logic and the compiler-based diagnostics.
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
} from './svelte-parts.js';
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
		const { parts, notes } = splitSvelteSource(TS_SOURCE);
		expect(notes).toEqual([]);
		expect(parts.scriptLang).toBe('ts');
		expect(parts.script).toBe("let { title = 'Hi' }: { title?: string } = $props();");
		expect(parts.markup).toBe('<h1>{title}</h1>');
		expect(parts.style).toBe('h1 {\n\tcolor: red;\n}');
		expect(parts.scriptIndent).toBe('\t');
	});

	it('detects plain JavaScript and module scripts and keeps extra attributes', () => {
		const { parts } = splitSvelteSource(
			'<script module>\n\texport const x = 1;\n</script>\n<script generics="T">\n\tlet a = 1;\n</script>\n<p>x</p>'
		);
		expect(parts.moduleScript).toBe('export const x = 1;');
		expect(parts.scriptLang).toBe('js');
		expect(parts.scriptAttrs).toBe('generics="T"');
	});

	it('keeps nested scripts in the markup and handles files without blocks', () => {
		const { parts } = splitSvelteSource(
			'<svelte:head><script>1</script></svelte:head>\n<p>a</p>'
		);
		expect(parts.script).toBe('');
		expect(parts.markup).toContain('<svelte:head>');
	});

	it('still splits a file that does not parse', () => {
		const { parts } = splitSvelteSource('<script>\n\tlet a = ;\n</script>\n<p>{</p>');
		expect(parts.script).toBe('let a = ;');
		expect(parts.markup).toBe('<p>{</p>');
	});
});

describe('joinSvelteSource', () => {
	it('round-trips a typical file exactly', () => {
		const { parts } = splitSvelteSource(TS_SOURCE);
		expect(joinSvelteSource(parts).source).toBe(TS_SOURCE);
	});

	it('round-trips every bundled component to a stable fixed point', () => {
		const dir = join(import.meta.dirname, 'components/editor');
		for (const name of readdirSync(dir).filter((f) => f.endsWith('.svelte'))) {
			const original = readFileSync(join(dir, name), 'utf8');
			const once = joinSvelteSource(splitSvelteSource(original).parts).source;
			const twice = joinSvelteSource(splitSvelteSource(once).parts).source;
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
	it('maps whole-file positions back into part editors', () => {
		const { parts } = splitSvelteSource(TS_SOURCE);
		const { source, map } = joinSvelteSource(parts);
		expect(source).toBe(TS_SOURCE);
		// Line 2 col 1 is the first char after the tab -> script line 1 col 0.
		expect(mapSourcePosition(map, 2, 1)).toEqual({ part: 'script', line: 1, column: 0 });
		expect(mapSourcePosition(map, 5, 4)?.section).toBe('markup');
		expect(mapSourcePosition(map, 9, 2)).toEqual({ part: 'style', line: 2, column: 1 });
	});

	it('routes compiler errors to the right part', () => {
		const { parts } = splitSvelteSource('<script>\n\tlet a = 1;\n</script>\n\n<p>{</p>');
		parts.markup = '<div>\n\t{#if a}\n</div>';
		const { source, map } = joinSvelteSource(parts);
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
