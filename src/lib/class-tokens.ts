/**
 * @fileoverview Contextual class-token discovery for CodeMirror's HTML, Svelte
 * and CSS trees. All ranges are absolute UTF-16 offsets, end-exclusive (not line
 * coordinates). The syntax tree gates discovery; only attribute-local text is
 * split. Expressions are never evaluated, and interpolated fragments are labelled
 * dynamic rather than looked up as if they were complete classes.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** Hover target in source coordinates; `dynamic` targets have no reliable class value. */
export interface ClassToken {
	from: number;
	to: number;
	name: string;
	dynamic?: boolean;
	conditional?: boolean;
}

/** Decodes CSS identifier escapes, including up to six hex digits and optional whitespace. */
export function decodeCssIdentifier(value: string): string {
	return value.replace(/\\([0-9a-f]{1,6}\s?|[^\n\r\f])/gi, (_, escaped: string) => {
		if (!/^[0-9a-f]/i.test(escaped)) return escaped;
		const point = parseInt(escaped.trim(), 16);
		return String.fromCodePoint(
			point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? 0xfffd : point
		);
	});
}

/** Applies CodeMirror's side convention: left edge belongs to side +1, right to -1. */
function contains(from: number, to: number, pos: number, side: number): boolean {
	return pos >= from && pos <= to && !(pos === from && side < 0) && !(pos === to && side > 0);
}

/**
 * Finds a complete class at a pointer offset without `wordAt` punctuation loss.
 * Supports template-only and full-file Svelte, static chunks of mixed attributes,
 * literal className attributes, class directives and escaped CSS class selectors.
 * Dynamic expressions and partial tokens return an explicit dynamic target.
 */
export function classTokenAt(
	state: EditorState,
	pos: number,
	side: -1 | 1,
	language: 'svelte' | 'html' | 'css'
): ClassToken | null {
	const read = (from: number, to: number) => state.sliceDoc(from, to);
	let node = syntaxTree(state).resolveInner(pos, side);
	for (let current = node; current;) {
		if (current.name === 'ClassName' && current.parent?.name === 'ClassSelector') {
			// CSS inside a Svelte <style> is also useful; scripts/comments never have this node.
			return contains(current.from, current.to, pos, side)
				? {
						from: current.from,
						to: current.to,
						name: decodeCssIdentifier(read(current.from, current.to))
					}
				: null;
		}
		if (language === 'css') return null;
		if (current.name === 'Directive') {
			const target = current.getChild('DirectiveClass')?.getChild('DirectiveTarget');
			return target && contains(target.from, target.to, pos, side)
				? {
						from: target.from,
						to: target.to,
						name: read(target.from, target.to),
						conditional: true
					}
				: null;
		}
		if (current.name === 'Attribute') {
			node = current;
			break;
		}
		if (!current.parent) return null;
		current = current.parent;
	}
	const attrName = node.getChild('AttributeName');
	if (!attrName || !['class', 'className'].includes(read(attrName.from, attrName.to))) return null;
	const value = node.getChild('AttributeValue') ?? node.getChild('UnquotedAttributeValue');
	if (!value) return null;
	let from = value.from;
	let to = value.to;
	const quote = read(from, from + 1);
	if (quote === '"' || quote === "'") {
		from++;
		if (read(to - 1, to) === quote) to--;
	}
	if (!contains(from, to, pos, side)) return null;

	// Interpolations are tree nodes, so whitespace/quotes/braces inside JavaScript
	// cannot accidentally become class boundaries in a mixed attribute.
	const expressions: { from: number; to: number }[] = [];
	value.toTree().iterate({
		enter(ref) {
			if (ref.name !== 'Interpolation') return;
			expressions.push({ from: value.from + ref.from, to: value.from + ref.to });
			return false;
		}
	});
	const expression = expressions.find((part) => contains(part.from, part.to, pos, side));
	if (expression)
		return { ...expression, name: read(expression.from, expression.to), dynamic: true };
	const text = read(from, to);
	for (const match of text.matchAll(/\S+/g)) {
		let start = from + match.index;
		let end = start + match[0].length;
		if (!contains(start, end, pos, side)) continue;
		// Expand through expression bodies (which may themselves contain spaces).
		for (const part of expressions) {
			if (part.from < end && part.to > start) {
				start = Math.min(start, part.from);
				end = Math.max(end, part.to);
			}
		}
		const dynamic = expressions.some((part) => part.from < end && part.to > start);
		return { from: start, to: end, name: read(start, end), dynamic };
	}
	return null;
}
