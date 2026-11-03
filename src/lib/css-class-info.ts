/**
 * @fileoverview Browser-only index of the actual loaded CSSOM, not a Tailwind
 * class catalogue. Walks imports, grouping and native nested rules; records
 * authored selectors, conditions and declarations without pretending to compute
 * a component's cascade. Selector tokenization excludes ancestor/negative/context
 * classes, while preserving positive :is/:where owners and native `&` ownership.
 *
 * A per-Document cache observes stylesheet DOM/HMR changes and load events.
 * Shallow sheet identity/state checks catch adopted sheets and disabled changes.
 * A one-second maximum age catches otherwise unobservable CSSOM writes (including
 * declaration edits and replaceSync) on the next lookup, never per mousemove.
 * No globals, document access, fetching or CSS execution occur at module load.
 */
import { decodeCssIdentifier } from './class-tokens.js';

/** One authored declaration; custom-property references remain intact. */
export interface CssDeclaration {
	property: string;
	value: string;
}

/** A directly owned declaration block, not a computed cascade winner. */
export interface ClassRule {
	selector: string;
	declarations: CssDeclaration[];
	conditions: string[];
	source: string;
}

/** Lookup result with explicit access limitations; an empty rules array is meaningful. */
export interface ClassCssInfo {
	rules: ClassRule[];
	warnings: string[];
	truncated: boolean;
	variables: { name: string; value: string }[];
}

/** Selector-list branch with its subject classes and native nesting marker. */
interface SelectorOwner {
	classes: Set<string>;
	inherits: boolean;
}

/** Consumes a CSS escape as one unit, including escaped spaces/commas/combinators. */
function escapeEnd(text: string, start: number): number {
	let end = start + 1;
	if (/[0-9a-f]/i.test(text[end] ?? '')) {
		while (end < start + 7 && /[0-9a-f]/i.test(text[end] ?? '')) end++;
		if (/\s/.test(text[end] ?? '')) end++;
	} else if (end < text.length) end++;
	return end;
}

/** Reads a balanced function/attribute, respecting quoted strings and escapes. */
function balancedEnd(text: string, start: number): number {
	const close = text[start] === '(' ? ')' : ']';
	let depth = 1;
	let quote = '';
	for (let i = start + 1; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') {
			i = escapeEnd(text, i) - 1;
			continue;
		}
		if (quote) {
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === text[start]) depth++;
		if (char === close && --depth === 0) return i + 1;
	}
	return text.length;
}

/**
 * Tokenizes only the final compound of each selector-list branch. Classes in
 * :not/:has/nth-* or attribute strings are context, not the styled subject.
 * Native nesting without an explicit `&` is a descendant, not inherited ownership.
 */
function selectorOwners(selector: string): SelectorOwner[] {
	const branches: SelectorOwner[] = [];
	let owner: SelectorOwner = { classes: new Set(), inherits: false };
	let positive = new Set<string>();
	const finish = () => {
		// In `.utility:where(.dark, .dark *)`, dark is a qualification, not
		// another owner. A standalone `:is(.a, .b)` does own a/b.
		if (!owner.classes.size && !owner.inherits) owner.classes = positive;
		return owner;
	};
	const reset = () => {
		owner = { classes: new Set(), inherits: false };
		positive = new Set();
	};
	for (let i = 0; i < selector.length;) {
		const char = selector[i];
		if (selector.startsWith('/*', i)) {
			const end = selector.indexOf('*/', i + 2);
			i = end < 0 ? selector.length : end + 2;
			continue;
		}
		if (char === ',') {
			branches.push(finish());
			reset();
			i++;
			continue;
		}
		if (/\s|[>+~|]/.test(char)) {
			reset();
			i++;
			continue;
		}
		if (char === '[') {
			i = balancedEnd(selector, i);
			continue;
		}
		if (char === '&') {
			owner.inherits = true;
			i++;
			continue;
		}
		if (char === ':' && selector[i + 1] !== ':') {
			const match = /^:([\w-]+)\(/.exec(selector.slice(i));
			if (match) {
				const start = i + match[0].length - 1;
				const end = balancedEnd(selector, start);
				if (match[1] === 'is' || match[1] === 'where') {
					for (const inner of selectorOwners(selector.slice(start + 1, end - 1))) {
						for (const name of inner.classes) positive.add(name);
						owner.inherits ||= inner.inherits;
					}
				}
				i = end;
				continue;
			}
		}
		if (char === '.') {
			const start = ++i;
			while (i < selector.length) {
				if (selector[i] === '\\') {
					i = escapeEnd(selector, i);
					continue;
				}
				if (!/[\w\u0080-\uffff-]/.test(selector[i])) break;
				i++;
			}
			if (i > start) owner.classes.add(decodeCssIdentifier(selector.slice(start, i)));
			continue;
		}
		if (char === '\\') i = escapeEnd(selector, i);
		else i++;
	}
	branches.push(finish());
	return branches;
}

/** Returns the positive subject class identifiers in a selector (not substrings). */
export function selectorClassOwners(selector: string): string[] {
	return [...new Set(selectorOwners(selector).flatMap((owner) => [...owner.classes]))];
}

/** Shared index lifetime is owned by consumers, so editor teardown releases observers. */
interface CssIndex {
	lookup(name: string, context: Element): ClassCssInfo;
	release(): void;
}

const indexes = new WeakMap<Document, { index: CssIndex; retain: number }>();

/**
 * Acquires a document-local CSSOM index. Call `release` exactly once per consumer.
 * Theme variables are read fresh from the editor's inherited computed style, not
 * from a guessed root palette; this is explicitly not component runtime context.
 */
export function acquireClassCssIndex(doc: Document): CssIndex {
	const existing = indexes.get(doc);
	if (existing) {
		existing.retain++;
		return existing.index;
	}
	let dirty = true;
	let builtAt = 0;
	let previousSheets: CSSStyleSheet[] = [];
	let previousStates = '';
	let rulesByClass = new Map<string, ClassRule[]>();
	let warnings: string[] = [];
	const invalidate = () => {
		dirty = true;
	};
	const observer = new MutationObserver((mutations) => {
		if (
			mutations.some((mutation) => {
				const target =
					mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
				return (
					target?.closest('style, link[rel~="stylesheet"]') ||
					[...mutation.addedNodes, ...mutation.removedNodes].some(
						(node) =>
							node instanceof Element &&
							(node.matches('style, link') || node.querySelector('style, link'))
					)
				);
			})
		)
			invalidate();
	});
	observer.observe(doc.documentElement, {
		subtree: true,
		childList: true,
		characterData: true,
		attributes: true,
		attributeFilter: ['href', 'rel', 'media', 'disabled']
	});
	doc.addEventListener('load', invalidate, true);

	/** Rebuilds the index once, including readable imports and inherited conditions. */
	function rebuild(sheets: CSSStyleSheet[]) {
		rulesByClass = new Map();
		const limits = new Set<string>();
		const visited = new Set<CSSStyleSheet>();
		function walkSheet(sheet: CSSStyleSheet, conditions: string[]) {
			if (visited.has(sheet)) return;
			visited.add(sheet);
			const source =
				sheet.href ??
				(sheet.ownerNode instanceof Element
					? (sheet.ownerNode.getAttribute('data-vite-dev-id') ?? 'inline stylesheet')
					: 'adopted stylesheet');
			const extra = [...conditions];
			if (sheet.disabled) extra.push('stylesheet disabled');
			if (sheet.media.mediaText) extra.push(`@media ${sheet.media.mediaText}`);
			try {
				walkRules(sheet.cssRules, extra, source, [], []);
			} catch {
				limits.add(`Cannot read stylesheet: ${source} (browser access restriction).`);
			}
			visited.delete(sheet);
		}
		function walkRules(
			list: CSSRuleList,
			conditions: string[],
			source: string,
			parents: string[],
			inherited: string[]
		) {
			for (const rule of Array.from(list)) {
				if (rule instanceof CSSImportRule) {
					const extra = [...conditions];
					if (rule.media.mediaText) extra.push(`@media ${rule.media.mediaText}`);
					if (rule.supportsText) extra.push(`@supports ${rule.supportsText}`);
					if (rule.layerName !== null && rule.layerName !== undefined)
						extra.push(`@layer ${rule.layerName || '(anonymous)'}`);
					if (rule.styleSheet) walkSheet(rule.styleSheet, extra);
					else limits.add(`Imported stylesheet not loaded: ${rule.href}`);
					continue;
				}
				if (rule instanceof CSSStyleRule) {
					const owners = selectorOwners(rule.selectorText);
					const names = [
						...new Set(
							owners.flatMap((owner) => [...owner.classes, ...(owner.inherits ? inherited : [])])
						)
					];
					const selectors = [...parents, rule.selectorText];
					const declarations = Array.from(rule.style).map((property) => ({
						property,
						value:
							rule.style.getPropertyValue(property).trim() +
							(rule.style.getPropertyPriority(property) ? ' !important' : '')
					}));
					if (declarations.length)
						record(names, {
							selector: selectors.join(' → '),
							declarations,
							conditions: [...conditions],
							source
						});
					if (rule.cssRules?.length) walkRules(rule.cssRules, conditions, source, selectors, names);
					continue;
				}
				// CSSNestedDeclarations represents a declaration run after a nested rule.
				if ('style' in rule && parents.length && rule.style instanceof CSSStyleDeclaration) {
					const style = rule.style;
					record(inherited, {
						selector: parents.join(' → '),
						conditions: [...conditions],
						source,
						declarations: Array.from(style).map((property) => ({
							property,
							value:
								style.getPropertyValue(property).trim() +
								(style.getPropertyPriority(property) ? ' !important' : '')
						}))
					});
				}
				if ('cssRules' in rule) {
					const heading = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
					walkRules(
						rule.cssRules as CSSRuleList,
						[...conditions, heading],
						source,
						parents,
						inherited
					);
				}
			}
		}
		function record(names: string[], rule: ClassRule) {
			for (const name of names) {
				const found = rulesByClass.get(name) ?? [];
				found.push(rule);
				rulesByClass.set(name, found);
			}
		}
		for (const sheet of sheets) walkSheet(sheet, []);
		warnings = [...limits];
		builtAt = Date.now();
		dirty = false;
	}
	const index: CssIndex = {
		lookup(name, context) {
			const sheets = [...doc.styleSheets, ...doc.adoptedStyleSheets];
			const states = sheets.map((sheet) => `${sheet.disabled}:${sheet.media.mediaText}`).join('|');
			if (
				dirty ||
				Date.now() - builtAt >= 1000 ||
				states !== previousStates ||
				sheets.length !== previousSheets.length ||
				sheets.some((sheet, i) => sheet !== previousSheets[i])
			) {
				rebuild(sheets);
				previousSheets = sheets;
				previousStates = states;
			}
			const all = rulesByClass.get(name) ?? [];
			const rules = all.slice(0, 24);
			const names = new Set(
				rules.flatMap((rule) =>
					rule.declarations.flatMap((decl) =>
						[...decl.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
					)
				)
			);
			const computed = doc.defaultView?.getComputedStyle(context);
			return {
				rules,
				warnings: [...warnings],
				truncated: all.length > rules.length,
				variables: [...names].map((name) => ({
					name,
					value: computed?.getPropertyValue(name).trim() || 'unresolved in the editor theme'
				}))
			};
		},
		release() {
			const entry = indexes.get(doc);
			if (entry && --entry.retain === 0) {
				observer.disconnect();
				doc.removeEventListener('load', invalidate, true);
				indexes.delete(doc);
			}
		}
	};
	indexes.set(doc, { index, retain: 1 });
	return index;
}
