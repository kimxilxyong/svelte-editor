/**
 * @fileoverview Sanity checks ("lint") for Svelte component source using the official compiler.
 *
 * {@link checkSvelteSource} runs `svelte/compiler` in analysis-only mode (`generate: false`) and
 * converts everything it reports into plain {@link SourceDiagnostic} objects:
 *
 * - **Errors** – syntax errors, invalid rune usage, `<script lang="ts">` type syntax problems…
 *   The compiler throws on the first error, so at most one error is reported per run.
 * - **Warnings** – accessibility (`a11y_*`), unused CSS selectors, state-reference mistakes etc.
 *   They are collected from the compile result and never block saving.
 *
 * The module is isomorphic (no DOM, no Node APIs): the component editor page calls it live while
 * typing (debounced) and the server calls it again before writing a file, so the browser and the
 * API always agree on what "valid" means.
 *
 * Positions follow the editor conventions used by `svelte-sections.ts`: lines are 1-based,
 * columns are 0-based and refer to the complete file text.
 */

import { compile } from 'svelte/compiler';
import type { SourceDiagnostic } from './svelte-sections.js';

/** Result of {@link checkSvelteSource}. */
export type CheckResult = {
	/** `true` when no diagnostic has severity `error`. */
	ok: boolean;
	/** All errors and warnings, errors first. */
	diagnostics: SourceDiagnostic[];
};

/** Minimal shape shared by compiler warnings and thrown compile errors. */
type CompilerMessage = {
	message?: string;
	code?: string;
	start?: { line: number; column: number };
	end?: { line: number; column: number };
};

/**
 * Converts a compiler message into a {@link SourceDiagnostic}.
 *
 * Svelte reports 1-based lines and 0-based columns already, so no shifting is needed. Messages
 * without location (rare, e.g. for the whole component) are pinned to line 1.
 *
 * @param item - Compiler warning or error.
 * @param severity - Severity to assign.
 */
function toDiagnostic(item: CompilerMessage, severity: 'error' | 'warning'): SourceDiagnostic {
	// The compiler appends the documentation URL and a code frame; keep just the first line.
	const message = (item.message ?? 'Unknown problem').split('\n')[0].trim();
	return {
		severity,
		message,
		code: item.code,
		line: item.start?.line ?? 1,
		column: item.start?.column ?? 0,
		endLine: item.end?.line,
		endColumn: item.end?.column
	};
}

/**
 * Checks a complete `.svelte` file for compile errors and warnings.
 *
 * @param source - Full file text (use `joinSvelteSource(sections).source`).
 * @param filename - Used by the compiler for messages and component naming. Defaults to
 *   `Component.svelte`.
 * @returns `ok` plus the list of diagnostics. Never throws.
 * @example
 * const { ok, diagnostics } = checkSvelteSource('<p>{</p>');
 * ok; // false
 * diagnostics[0].severity; // 'error'
 */
export function checkSvelteSource(source: string, filename = 'Component.svelte'): CheckResult {
	const diagnostics: SourceDiagnostic[] = [];
	try {
		const result = compile(source, { generate: false, filename, runes: undefined });
		for (const warning of result.warnings) {
			diagnostics.push(toDiagnostic(warning as CompilerMessage, 'warning'));
		}
	} catch (error) {
		diagnostics.unshift(toDiagnostic(error as CompilerMessage, 'error'));
	}
	diagnostics.sort((a, b) =>
		a.severity === b.severity
			? a.line - b.line || a.column - b.column
			: a.severity === 'error'
				? -1
				: 1
	);
	return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
}
