/**
 * @fileoverview Additive CodeMirror completion sources. Native language sources
 * still own HTML tags/attributes, CSS properties/values and JS/TS lexical names.
 * This module adds loaded CSSOM/document class names and Svelte rune snippets;
 * it performs no fetches, evaluation or TypeScript language-server inference.
 * All replacement ranges use absolute UTF-16 offsets, end-exclusive.
 */
import {
	snippetCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { classTokenAt, decodeCssIdentifier } from './class-tokens.js';
import { selectorClassOwners } from './css-class-info.js';

/** Supported modes, independent of the component to keep this module isomorphic. */
export type CompletionLanguage = 'html' | 'svelte' | 'css' | 'javascript' | 'typescript';

/** Absolute replacement span and whether insertion requires CSS identifier escaping. */
export interface ClassCompletionRange {
	from: number;
	to: number;
	css: boolean;
}

/**
 * Finds only static class contexts, including an empty quoted class attribute.
 * Existing token discovery preserves variant/slash/arbitrary punctuation and
 * rejects mixed expression fragments rather than completing their suffixes.
 */
export function classCompletionRange(
	context: CompletionContext,
	language: CompletionLanguage
): ClassCompletionRange | null {
	if (language === 'javascript' || language === 'typescript') return null;
	const { state, pos } = context;
	const token = classTokenAt(state, pos, -1, language) ?? classTokenAt(state, pos, 1, language);
	if (token) {
		if (token.dynamic) return null;
		let node = syntaxTree(state).resolveInner(pos, -1);
		while (node.parent && node.name !== 'ClassSelector') node = node.parent;
		return { from: token.from, to: token.to, css: node.name === 'ClassSelector' };
	}
	for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
		if (node.name === 'ClassSelector' && state.sliceDoc(node.from, pos) === '.') {
			return { from: pos, to: pos, css: true };
		}
	}
	// Empty attributes have no token to hover. The tree still gates their bounds:
	// do not use a whole-document regexp that might match comments or JS strings.
	for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
		if (node.name !== 'Attribute') continue;
		const name = node.getChild('AttributeName');
		const value = node.getChild('AttributeValue');
		if (!name || !value || !['class', 'className'].includes(state.sliceDoc(name.from, name.to)))
			return null;
		const quote = state.sliceDoc(value.from, value.from + 1);
		if (!['"', "'"].includes(quote)) return null;
		const end = state.sliceDoc(value.to - 1, value.to) === quote ? value.to - 1 : value.to;
		if (
			pos > value.from &&
			pos <= end &&
			!/\S/.test(
				state
					.sliceDoc(value.from + 1, pos)
					.split(/\s/)
					.at(-1) ?? ''
			)
		) {
			// A position inside an interpolation never reaches this attribute.
			return { from: pos, to: pos, css: false };
		}
		return null;
	}
	return null;
}

/** Collects statically authored document classes using the same tree-backed token rules as hover. */
export function documentClassNames(state: EditorState, language: CompletionLanguage): string[] {
	if (language === 'javascript' || language === 'typescript') return [];
	const names = new Set<string>();
	syntaxTree(state).iterate({
		enter(node) {
			if (node.name === 'ClassName' && node.node.parent?.name === 'ClassSelector') {
				const token = classTokenAt(state, node.from, 1, language);
				if (token) names.add(token.name);
			}
			if (node.name !== 'AttributeValue' && node.name !== 'DirectiveTarget') return;
			const text = state.sliceDoc(node.from, node.to);
			for (const match of text.matchAll(/\S+/g)) {
				const token = classTokenAt(
					state,
					node.from + match.index + Math.min(1, match[0].length - 1),
					1,
					language
				);
				if (token && !token.dynamic) names.add(token.name);
			}
		}
	});
	return [...names];
}

/** Loaded class entry; declarations are authored previews, never computed cascade claims. */
interface LoadedClass {
	name: string;
	detail: string;
}

/**
 * Reads accessible loaded sheets, including imports, grouping, nesting and
 * adopted sheets. Uses the shared selector tokenizer without changing its API.
 * A short per-editor cache bounds CSSOM work; blocked sheets are skipped and
 * unknown/unbuilt Tailwind classes are deliberately not invented.
 */
function loadedClasses(doc: Document): LoadedClass[] {
	const entries = new Map<string, LoadedClass>();
	const visited = new Set<CSSStyleSheet>();
	let remaining = 30000;
	const walk = (rules: CSSRuleList) => {
		for (const rule of Array.from(rules)) {
			if (--remaining < 0) return;
			if ('selectorText' in rule && 'style' in rule) {
				const style = (rule as CSSStyleRule).style;
				const detail = Array.from(style)
					.slice(0, 3)
					.map((property) => `${property}: ${style.getPropertyValue(property).trim()}`)
					.join('; ');
				for (const name of selectorClassOwners((rule as CSSStyleRule).selectorText))
					entries.set(name, { name, detail });
			}
			if ('styleSheet' in rule) sheet((rule as CSSImportRule).styleSheet);
			if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
		}
	};
	const sheet = (value: CSSStyleSheet | null) => {
		if (!value || value.disabled || visited.has(value)) return;
		visited.add(value);
		try {
			walk(value.cssRules);
		} catch {
			/* Cross-origin sheets are inaccessible, not a reason to fetch. */
		}
	};
	for (const value of [...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets]) sheet(value);
	return [...entries.values()];
}

/** Small Svelte-only snippet set; native JS/TS snippets remain installed too. */
const runes: Completion[] = [
	snippetCompletion('$state(${initial})', {
		label: '$state',
		type: 'function',
		detail: 'Svelte reactive state',
		info: 'Creates reactive state. Tab moves through snippet fields.'
	}),
	snippetCompletion('$derived(${expression})', {
		label: '$derived',
		type: 'function',
		detail: 'Svelte computed value',
		info: 'Derives a value from reactive dependencies without an effect.'
	}),
	snippetCompletion('$effect(() => {\n\t${}\n})', {
		label: '$effect',
		type: 'function',
		detail: 'Svelte side effect',
		info: 'Runs a side effect; return a cleanup function when acquiring resources.'
	}),
	snippetCompletion('$props()', {
		label: '$props',
		type: 'function',
		detail: 'Svelte component props'
	}),
	snippetCompletion('$bindable(${initial})', {
		label: '$bindable',
		type: 'function',
		detail: 'Svelte bindable prop default'
	})
];

/**
 * Returns additive language data and a browser-owned class source. Installed in
 * the language Compartment so switching modes discards its cache/suggestions,
 * but never recreates the EditorView or overrides native autocomplete data.
 */
export function editorCompletionExtension(language: CompletionLanguage): Extension {
	let owner: Document | undefined;
	let cached: LoadedClass[] = [];
	let builtAt = -Infinity;
	const classes = (context: CompletionContext): CompletionResult | null => {
		const range = classCompletionRange(context, language);
		if (!range || (!context.explicit && range.from === context.pos)) return null;
		if (owner && Date.now() - builtAt > 1000) {
			cached = loadedClasses(owner);
			builtAt = Date.now();
		}
		const prefix = context.state.sliceDoc(range.from, context.pos);
		const names = new Map<string, Completion>();
		for (const { name, detail } of cached)
			names.set(name, {
				label: name,
				type: 'class',
				detail: 'Loaded CSS',
				info: detail
					? `Authored loaded CSS (conditions/cascade may vary):\n${detail}`
					: 'Class in an accessible loaded stylesheet.'
			});
		for (const name of documentClassNames(context.state, language)) {
			if (!names.has(name))
				names.set(name, {
					label: name,
					type: 'class',
					detail: 'Document class',
					info: 'Statically authored in this document; not necessarily a loaded CSS rule.'
				});
		}
		const decoded = range.css ? decodeCssIdentifier(prefix.replace(/\\$/, '')) : prefix;
		return {
			from: range.from,
			to: range.to,
			// Strict prefix matching avoids punctuation-insensitive fuzzy matches.
			filter: false,
			options: [...names.values()]
				.filter((entry) => entry.label.startsWith(decoded))
				.sort((a, b) => a.label.localeCompare(b.label))
				.map((entry) => ({
					...entry,
					apply: range.css && owner ? owner.defaultView!.CSS.escape(entry.label) : entry.label
				}))
		};
	};
	const script = (context: CompletionContext): CompletionResult | null => {
		if (
			language !== 'svelte' ||
			!(
				javascriptLanguage.isActiveAt(context.state, context.pos, -1) ||
				typescriptLanguage.isActiveAt(context.state, context.pos, -1)
			)
		)
			return null;
		for (
			let node = syntaxTree(context.state).resolveInner(context.pos, -1);
			node;
			node = node.parent!
		) {
			if (/Comment|String|TemplateString|RegExp/.test(node.name)) return null;
		}
		const word = context.matchBefore(/[$\w]+/);
		if (!word && !context.explicit) return null;
		const from = word?.from ?? context.pos;
		if (context.state.sliceDoc(Math.max(0, from - 1), from) === '.') return null;
		return { from, options: runes, validFor: /^[$\w]*$/ };
	};
	return [
		ViewPlugin.define((view) => {
			owner = view.dom.ownerDocument;
			return {
				destroy() {
					owner = undefined;
					cached = [];
				}
			};
		}),
		EditorState.languageData.of(() => [{ autocomplete: classes }, { autocomplete: script }])
	];
}
