/**
 * @fileoverview Splitting a native `.svelte` file into its editable parts and joining it back.
 *
 * The component editor (`/component-editor`) shows a Svelte single-file component as three
 * separate code editors – **Script**, **Markup** (HTML + Svelte template syntax) and **Style**
 * (CSS) – plus an optional **Module script** (`<script module>`). This module is the pure,
 * framework-free core of that feature:
 *
 * 1. {@link splitSvelteSource} turns file text into {@link SvelteParts}.
 * 2. {@link joinSvelteSource} turns parts back into file text *and* returns a
 *    {@link PartMap} describing which output lines belong to which part.
 * 3. {@link mapSourcePosition} / {@link distributeDiagnostics} use that map to translate
 *    compiler diagnostics (which refer to line/column in the *whole file*) into positions
 *    inside the individual part editors.
 *
 * ## Design notes
 * - **Block discovery** prefers the real Svelte parser (`parse(..., { modern: true })`), which
 *   knows exactly where the top-level `<script>`/`<style>` blocks are. If the file does not parse
 *   (the user is mid-edit or the file is broken) a tolerant scanner is used so a damaged file
 *   can still be opened and fixed.
 * - **Round-trip stability**: the common indentation of script/style content (typically one tab,
 *   as written by Prettier) is detected on split, removed for editing and re-applied on join.
 *   Attributes other than `lang` (for example `generics="T"`) are preserved verbatim.
 * - **Normalisation**: on join the block order is always module script → instance script →
 *   markup → style, separated by one blank line, and the file ends with a single newline.
 * - Only the **top-level** blocks are split out; a `<script>` nested in markup (for instance
 *   inside `<svelte:head>`) stays in the markup part.
 *
 * Interactions: consumed by `routes/component-editor/+page.svelte`; diagnostics come from
 * `svelte-diagnostics.ts`; it has no dependency on the DOM, so it is unit tested in
 * `svelte-parts.spec.ts`.
 */

import { parse } from 'svelte/compiler';

/** Script language of a `<script>` block. `ts` corresponds to `lang="ts"`. */
export type ScriptLang = 'js' | 'ts';

/** Identifier of an editable part. */
export type PartId = 'moduleScript' | 'script' | 'markup' | 'style';

/**
 * The editable parts of a `.svelte` file. Text fields never include the surrounding tags and
 * are already de-indented (see {@link joinSvelteSource} for how indentation is restored).
 */
export type SvelteParts = {
	/** Instance `<script>` body (runs per component instance; where `$props()` lives). */
	script: string;
	/** Language of the instance script. */
	scriptLang: ScriptLang;
	/** Extra attributes of the instance script tag except `lang`, e.g. `generics="T"`. */
	scriptAttrs: string;
	/** Leading whitespace that was removed from every script line and is re-applied on join. */
	scriptIndent: string;
	/** `<script module>` body, or `''` when the file has none. */
	moduleScript: string;
	/** Language of the module script. */
	moduleLang: ScriptLang;
	/** Attributes of the module script tag except `lang` (always contains `module` / `context="module"`). */
	moduleAttrs: string;
	/** Indentation of the module script, see `scriptIndent`. */
	moduleIndent: string;
	/** Everything outside the script and style blocks: the HTML / Svelte template. */
	markup: string;
	/** `<style>` body (CSS), or `''` when the file has none. */
	style: string;
	/** Extra attributes of the style tag, e.g. `lang="scss"` (kept, highlighted as CSS). */
	styleAttrs: string;
	/** Indentation of the style block, see `scriptIndent`. */
	styleIndent: string;
};

/**
 * Describes where one part lives inside the text produced by {@link joinSvelteSource}.
 * Line numbers are **1-based** to match compiler diagnostics.
 */
export type PartMap = {
	part: PartId;
	/** Line of the opening tag (`<script …>`), or the first markup line for `markup`. */
	tagLine: number;
	/** Line of the first content line of the part. */
	startLine: number;
	/** Number of content lines (always ≥ 1). */
	lineCount: number;
	/** Indentation that was added to every non-blank content line. */
	indent: string;
};

/** A position inside one of the part editors (1-based line, 0-based column). */
export type PartPosition = {
	part: PartId;
	line: number;
	column: number;
};

/** Result of {@link splitSvelteSource}. */
export type SplitResult = {
	parts: SvelteParts;
	/** Human readable notes, e.g. "More than one instance script". Empty when the file is clean. */
	notes: string[];
};

/** Result of {@link joinSvelteSource}. */
export type JoinResult = {
	/** The complete `.svelte` file text. */
	source: string;
	/** Line map used to translate whole-file positions into part positions. */
	map: PartMap[];
};

/** A located top-level block inside the source text. */
type Block = { kind: 'script' | 'style'; start: number; end: number };

/** Matches an attribute list that may contain `>` inside quotes (e.g. `generics="Array<T>"`). */
const ATTRS = `((?:"[^"]*"|'[^']*'|[^>"'])*)`;
const blockPattern = new RegExp(`^<(script|style)\\b${ATTRS}>([\\s\\S]*?)<\\/\\1\\s*>$`, 'i');
const scanPattern = new RegExp(`<(script|style)\\b${ATTRS}>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');

/**
 * Creates an empty part set. Useful as the starting state of the editor page.
 *
 * @param lang - Script language for the instance script.
 * @returns A blank, tab-indented {@link SvelteParts}.
 */
export function emptyParts(lang: ScriptLang = 'ts'): SvelteParts {
	return {
		script: '',
		scriptLang: lang,
		scriptAttrs: '',
		scriptIndent: '\t',
		moduleScript: '',
		moduleLang: lang,
		moduleAttrs: 'module',
		moduleIndent: '\t',
		markup: '',
		style: '',
		styleAttrs: '',
		styleIndent: '\t'
	};
}

/**
 * Builds the source of a brand new component.
 *
 * @param lang - `'ts'` for `<script lang="ts">`, `'js'` for plain JavaScript.
 * @returns A minimal, valid Svelte 5 component using the `$props()` rune.
 * @example
 * newComponentSource('ts'); // '<script lang="ts">\n\tlet { title = \'Hello\' }: { title?: string } = $props();\n</script>…'
 */
export function newComponentSource(lang: ScriptLang = 'ts'): string {
	const parts = emptyParts(lang);
	parts.script =
		lang === 'ts'
			? "let { title = 'Hello' }: { title?: string } = $props();"
			: "let { title = 'Hello' } = $props();";
	parts.markup = '<h2>{title}</h2>';
	parts.style = 'h2 {\n\tmargin: 0;\n}';
	return joinSvelteSource(parts).source;
}

/**
 * Finds the top-level `<script>` / `<style>` blocks.
 *
 * Strategy: ask the real parser first (exact, handles nesting); on a parse error fall back to a
 * regular-expression scan that ignores matches inside HTML comments.
 *
 * @param source - Complete file text.
 * @returns Blocks sorted by start offset.
 */
function locateBlocks(source: string): Block[] {
	try {
		const ast = parse(source, { modern: true });
		const blocks: Block[] = [];
		for (const node of [ast.module, ast.instance]) {
			if (node) blocks.push({ kind: 'script', start: node.start, end: node.end });
		}
		if (ast.css) blocks.push({ kind: 'style', start: ast.css.start, end: ast.css.end });
		return blocks.sort((a, b) => a.start - b.start);
	} catch {
		// Fallback for files that do not parse: tolerate and let the diagnostics explain.
		const comments: [number, number][] = [];
		for (const match of source.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
			comments.push([match.index, match.index + match[0].length]);
		}
		const blocks: Block[] = [];
		for (const match of source.matchAll(scanPattern)) {
			const start = match.index;
			if (comments.some(([from, to]) => start >= from && start < to)) continue;
			blocks.push({
				kind: match[1].toLowerCase() === 'script' ? 'script' : 'style',
				start,
				end: start + match[0].length
			});
		}
		return blocks;
	}
}

/**
 * Longest whitespace prefix shared by every non-blank line.
 *
 * @param text - Block content.
 * @returns The common indentation (`''` when lines are flush-left or mixed).
 */
function commonIndent(text: string): string {
	let indent: string | null = null;
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		const lead = /^[ \t]*/.exec(line)![0];
		if (indent === null) {
			indent = lead;
			continue;
		}
		let i = 0;
		while (i < indent.length && i < lead.length && indent[i] === lead[i]) i++;
		indent = indent.slice(0, i);
	}
	return indent ?? '';
}

/**
 * Removes the block's surrounding blank lines and its common indentation.
 *
 * @param raw - Text between the opening and closing tag.
 * @returns The de-indented body and the indentation that was removed.
 */
function dedent(raw: string): { text: string; indent: string } {
	const trimmed = raw.replace(/^[ \t]*\r?\n/, '').replace(/\s+$/, '');
	const indent = commonIndent(trimmed);
	if (!indent) return { text: trimmed, indent: '' };
	const text = trimmed
		.split('\n')
		.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
		.join('\n');
	return { text, indent };
}

/**
 * Re-applies indentation to every non-blank line.
 *
 * @param text - De-indented text.
 * @param indent - Whitespace to prefix.
 */
function indentText(text: string, indent: string): string {
	if (!indent) return text;
	return text
		.split('\n')
		.map((line) => (line.trim() === '' ? line : indent + line))
		.join('\n');
}

/**
 * Separates the `lang` attribute from the remaining attribute text of a tag.
 *
 * @param attrs - Raw attribute text of the opening tag.
 * @returns `lang` (`'ts'` or `'js'`) and the other attributes joined by single spaces.
 */
function splitLang(attrs: string): { lang: ScriptLang; rest: string } {
	let lang: ScriptLang = 'js';
	const rest = attrs.replace(/\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i, (_all, a, b, c) => {
		const value = String(a ?? b ?? c ?? '').toLowerCase();
		if (value === 'ts' || value === 'typescript') lang = 'ts';
		return '';
	});
	return { lang, rest: rest.trim().replace(/\s+/g, ' ') };
}

/** True when a script tag's attributes declare it as the module script. */
function isModuleScript(attrs: string): boolean {
	return /\bmodule\b/.test(attrs) || /\bcontext\s*=\s*["']module["']/.test(attrs);
}

/**
 * Splits `.svelte` file text into editable parts.
 *
 * @param source - Complete file text.
 * @returns The parts plus notes about anything that could not be represented
 *   (e.g. a second instance script, which stays in the markup so no code is lost).
 * @example
 * const { parts } = splitSvelteSource('<script lang="ts">\n\tlet a = 1;\n</script>\n\n<p>{a}</p>');
 * parts.script;     // 'let a = 1;'
 * parts.scriptLang; // 'ts'
 * parts.markup;     // '<p>{a}</p>'
 */
export function splitSvelteSource(source: string): SplitResult {
	const text = source.replace(/\r\n/g, '\n');
	const parts = emptyParts('js');
	const notes: string[] = [];
	const blocks = locateBlocks(text);

	let markup = '';
	let cursor = 0;
	let hasInstance = false;
	let hasModule = false;
	let hasStyle = false;

	for (const block of blocks) {
		if (block.start < cursor) continue; // overlapping match, ignore
		const slice = text.slice(block.start, block.end);
		const parts = blockPattern.exec(slice);
		if (!parts) continue;
		const attrs = parts[2].trim();
		const { text: body, indent } = dedent(parts[3]);

		let consumed = true;
		if (block.kind === 'style') {
			if (hasStyle) {
				notes.push('More than one <style> block: the extra one stays in the markup part.');
				consumed = false;
			} else {
				hasStyle = true;
				parts.style = body;
				parts.styleAttrs = attrs;
				parts.styleIndent = indent || '';
			}
		} else if (isModuleScript(attrs)) {
			if (hasModule) {
				notes.push('More than one module script: the extra one stays in the markup part.');
				consumed = false;
			} else {
				hasModule = true;
				const { lang, rest } = splitLang(attrs);
				parts.moduleScript = body;
				parts.moduleLang = lang;
				parts.moduleAttrs = rest || 'module';
				parts.moduleIndent = indent || '';
			}
		} else if (hasInstance) {
			notes.push('More than one instance <script>: the extra one stays in the markup part.');
			consumed = false;
		} else {
			hasInstance = true;
			const { lang, rest } = splitLang(attrs);
			parts.script = body;
			parts.scriptLang = lang;
			parts.scriptAttrs = rest;
			parts.scriptIndent = indent || '';
		}
		if (!consumed) continue;

		markup += text.slice(cursor, block.start);
		cursor = block.end;
	}
	markup += text.slice(cursor);
	parts.markup = markup.replace(/^\s*\n/, '').replace(/\s+$/, '');
	// Default style for freshly started parts of a file without blocks: tab-indented.
	if (!hasInstance) parts.scriptIndent = '\t';
	if (!hasStyle) parts.styleIndent = '\t';
	if (!hasModule) parts.moduleIndent = '\t';
	return { parts, notes };
}

/** Builds an opening tag from its name, language and remaining attributes. */
function openTag(name: 'script' | 'style', lang: ScriptLang | null, attrs: string): string {
	const parts: string[] = [];
	if (attrs.trim()) parts.push(attrs.trim());
	if (lang === 'ts') parts.push('lang="ts"');
	// `lang` goes first for scripts, matching the convention `<script lang="ts" generics="T">`.
	if (lang === 'ts' && parts.length > 1) parts.unshift(parts.pop()!);
	return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}>`;
}

/**
 * Assembles parts into complete `.svelte` file text.
 *
 * Empty module scripts and styles are omitted. An empty instance script is omitted too unless it
 * is TypeScript (so the `lang="ts"` choice is not lost).
 *
 * @param parts - The editable parts.
 * @returns The file text and the {@link PartMap} for diagnostics mapping.
 */
export function joinSvelteSource(parts: SvelteParts): JoinResult {
	const chunks: { part: PartId; tag: string; body: string; closing: string | null }[] = [];
	const blank = (text: string) => text.trim() === '';

	if (!blank(parts.moduleScript)) {
		chunks.push({
			part: 'moduleScript',
			tag: openTag('script', parts.moduleLang, parts.moduleAttrs || 'module'),
			body: indentText(parts.moduleScript.replace(/\s+$/, ''), parts.moduleIndent),
			closing: '</script>'
		});
	}
	if (!blank(parts.script) || parts.scriptLang === 'ts') {
		chunks.push({
			part: 'script',
			tag: openTag('script', parts.scriptLang, parts.scriptAttrs),
			body: indentText(parts.script.replace(/\s+$/, ''), parts.scriptIndent),
			closing: '</script>'
		});
	}
	if (!blank(parts.markup)) {
		chunks.push({
			part: 'markup',
			tag: '',
			body: parts.markup.replace(/^\s*\n/, '').replace(/\s+$/, ''),
			closing: null
		});
	}
	if (!blank(parts.style)) {
		chunks.push({
			part: 'style',
			tag: openTag('style', null, parts.styleAttrs),
			body: indentText(parts.style.replace(/\s+$/, ''), parts.styleIndent),
			closing: '</style>'
		});
	}

	const lines: string[] = [];
	const map: PartMap[] = [];
	for (const chunk of chunks) {
		if (lines.length > 0) lines.push('');
		const indentOf = (id: PartId) =>
			id === 'script'
				? parts.scriptIndent
				: id === 'moduleScript'
					? parts.moduleIndent
					: id === 'style'
						? parts.styleIndent
						: '';
		const tagLine = lines.length + 1;
		if (chunk.tag) lines.push(chunk.tag);
		const bodyLines = chunk.body === '' ? [''] : chunk.body.split('\n');
		map.push({
			part: chunk.section,
			tagLine,
			startLine: lines.length + 1,
			lineCount: bodyLines.length,
			indent: indentOf(chunk.section)
		});
		lines.push(...bodyLines);
		if (chunk.closing) lines.push(chunk.closing);
	}
	return { source: lines.length ? lines.join('\n') + '\n' : '', map };
}

/**
 * Translates a position in the whole file into a position inside a part editor.
 *
 * Positions on a tag line (`<script lang="ts">`, `</style>`) are clamped to the first/last line of
 * the neighbouring part so errors about the tag itself are still shown somewhere useful.
 *
 * @param map - The map returned by {@link joinSvelteSource}.
 * @param line - 1-based line in the whole file.
 * @param column - 0-based column in the whole file.
 * @returns The part position, or `null` when the file has no parts at all.
 */
export function mapSourcePosition(
	map: PartMap[],
	line: number,
	column: number
): PartPosition | null {
	for (const entry of map) {
		const first = entry.startLine;
		const last = entry.startLine + entry.lineCount - 1;
		if (line >= first && line <= last) {
			return {
				part: entry.section,
				line: line - first + 1,
				// Content lines were indented on join; the editor shows them de-indented.
				column: Math.max(0, column - entry.indent.length)
			};
		}
	}
	// On a tag line or blank separator: attach to the nearest part.
	let best: PartMap | null = null;
	let distance = Infinity;
	for (const entry of map) {
		const d = Math.min(
			Math.abs(line - entry.startLine),
			Math.abs(line - (entry.startLine + entry.lineCount - 1))
		);
		if (d < distance) {
			distance = d;
			best = entry;
		}
	}
	if (!best) return null;
	return line < best.startLine
		? { part: best.section, line: 1, column: 0 }
		: { part: best.section, line: best.lineCount, column: 0 };
}

/** A diagnostic whose position refers to the whole file (as reported by the compiler). */
export type SourceDiagnostic = {
	severity: 'error' | 'warning' | 'info';
	message: string;
	/** Compiler warning/error code, e.g. `css_unused_selector`. */
	code?: string;
	/** 1-based line in the whole file. */
	line: number;
	/** 0-based column in the whole file. */
	column: number;
	endLine?: number;
	endColumn?: number;
};

/** A diagnostic positioned inside one part editor. */
export type PartDiagnostic = {
	severity: 'error' | 'warning' | 'info';
	message: string;
	code?: string;
	/** 1-based line inside the part. */
	line: number;
	/** 0-based column inside the part. */
	column: number;
	endLine?: number;
	endColumn?: number;
};

/**
 * Groups whole-file diagnostics by part, translating their positions.
 *
 * @param diagnostics - Diagnostics from `checkSvelteSource`.
 * @param map - Map from {@link joinSvelteSource} for the *same* text that was checked.
 * @returns Diagnostics per part (parts without problems map to an empty array).
 */
export function distributeDiagnostics(
	diagnostics: SourceDiagnostic[],
	map: PartMap[]
): Record<PartId, PartDiagnostic[]> {
	const grouped: Record<PartId, PartDiagnostic[]> = {
		moduleScript: [],
		script: [],
		markup: [],
		style: []
	};
	for (const item of diagnostics) {
		const start = mapSourcePosition(map, item.line, item.column);
		if (!start) continue;
		const end =
			item.endLine !== undefined && item.endColumn !== undefined
				? mapSourcePosition(map, item.endLine, item.endColumn)
				: null;
		const sameSection = end && end.section === start.section;
		grouped[start.section].push({
			severity: item.severity,
			message: item.message,
			code: item.code,
			line: start.line,
			column: start.column,
			endLine: sameSection ? end.line : undefined,
			endColumn: sameSection ? end.column : undefined
		});
	}
	return grouped;
}
