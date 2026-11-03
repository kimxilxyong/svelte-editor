/**
 * @fileoverview CodeMirror class hovers: syntax-tree token discovery feeds a
 * shared loaded-CSS index, then a text-only DOM tooltip. Educational descriptions
 * are derived from actual declarations, kept separate from authored CSS.
 * The extension is installed in the language compartment, so switching language
 * destroys its hover state without touching the document, selection or history.
 * No source execution, dynamic-expression evaluation or network requests occur.
 */
import { ViewPlugin, EditorView, hoverTooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { classTokenAt, type ClassToken } from './class-tokens.js';
import { acquireClassCssIndex, type ClassCssInfo } from './css-class-info.js';

/**
 * Gives short explanations of observed declarations, not inferred utility names.
 * Unknown classes deliberately get neither fabricated declarations nor name-based
 * claims. Links are static, trusted documentation URLs, never derived from source.
 */
function explain(info: ClassCssInfo): { hints: string[]; docs: [string, string][] } {
	const declarations = info.rules.flatMap((rule) => rule.declarations);
	const has = (property: string, value?: string) =>
		declarations.some(
			(decl) =>
				decl.property === property && (!value || decl.value.replace(/\s*!important$/, '') === value)
		);
	const hints: string[] = [];
	const docs: [string, string][] = [];
	if (has('height', '100%')) {
		hints.push(
			"Fills 100% of the containing block's height. Usually the parent needs a definite height; it does not mean the full screen."
		);
		docs.push(['Percentage height', 'https://developer.mozilla.org/en-US/docs/Web/CSS/height']);
	}
	if (has('display', 'flex') || has('display', 'inline-flex')) {
		hints.push(
			'Creates a flex layout: direct children become flex items. Direction, alignment and gaps are controlled by other declarations.'
		);
		docs.push([
			'Flex layout',
			'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout'
		]);
	}
	if (has('display', 'grid'))
		hints.push(
			'Creates a grid layout for direct children; column and row declarations define its tracks.'
		);
	if (
		declarations.some((decl) => /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(decl.property))
	) {
		hints.push(
			'Padding is space inside the border; margin is space outside it; gap separates layout items. Variable-based sizes follow the loaded theme.'
		);
	}
	if (has('color')) hints.push('Sets the text/foreground color; descendants may inherit it.');
	if (has('background-color'))
		hints.push('Paints the background behind the content; it does not set the text color.');
	if (declarations.some((decl) => decl.property.startsWith('border')))
		hints.push(
			'Changes the border. A visible border may also need width, style and color from other rules.'
		);
	if (has('font-size'))
		hints.push('Sets the text size. Check the accompanying line-height for line spacing.');
	if (info.rules.some((rule) => /(^|[^\\]):hover\b/.test(rule.selector)))
		hints.push(
			'The :hover pseudo-class tests whether the pointer is over an element. The complete selector below determines which element and whether that test is negated; enclosing media queries must also match.'
		);
	if (
		info.rules.some((rule) => rule.conditions.some((condition) => condition.startsWith('@media')))
	)
		hints.push(
			'Responsive/media rules only apply when their authored query matches; the queries below are not removed at the current viewport.'
		);
	if (
		info.rules.some(
			(rule) =>
				/(^|[^\\])\.dark(?=[\s.#:[),*]|$)/.test(rule.selector) ||
				rule.conditions.some((condition) => /prefers-color-scheme:\s*dark/.test(condition))
		)
	)
		hints.push(
			'Dark styling depends on the authored dark selector or media condition below, not on this tooltip’s color theme.'
		);
	if (info.rules.length) {
		docs.push(['Tailwind utilities', 'https://tailwindcss.com/docs/styling-with-utility-classes']);
		docs.push(['Theme variables', 'https://tailwindcss.com/docs/theme']);
		docs.push(['Flowbite theming', 'https://flowbite.com/docs/customize/configuration/']);
	}
	return { hints, docs };
}

/** Builds untrusted source/CSS exclusively with textContent, never innerHTML. */
function tooltipDom(doc: Document, token: ClassToken, info?: ClassCssInfo): HTMLElement {
	const root = doc.createElement('div');
	root.className = 'cm-class-hover';
	root.setAttribute('role', 'note');
	const add = (tag: string, text: string, parent: HTMLElement = root) => {
		const element = doc.createElement(tag);
		element.textContent = text;
		parent.append(element);
		return element;
	};
	add('strong', token.name);
	if (token.dynamic) {
		add(
			'p',
			'Dynamic class expression or fragment. Its final class depends on runtime values; expressions are not evaluated. Hover a complete literal class instead.'
		);
		return root;
	}
	if (token.conditional)
		add('p', 'Conditional Svelte class: applied only when its class: directive is truthy.');
	if (!info) return root;
	const { hints, docs } = explain(info);
	if (hints.length) {
		add('h4', 'Meaning');
		for (const hint of hints) add('p', hint);
	}
	add('h4', 'Actual loaded CSS');
	if (!info.rules.length) {
		add(
			'p',
			'No directly owned definition found in readable loaded stylesheets. Tailwind only builds classes detected in source; this class may not be generated or its stylesheet may not be loaded.'
		);
	}
	for (const rule of info.rules) {
		const block = add('section', '');
		add('p', `Source: ${rule.source}`, block).className = 'cm-class-source';
		if (rule.conditions.length) add('p', rule.conditions.join(' → '), block);
		add(
			'pre',
			`${rule.selector} {\n${rule.declarations
				.slice(0, 60)
				.map((decl) => `  ${decl.property}: ${decl.value};`)
				.join('\n')}\n}`,
			block
		);
		if (rule.declarations.length > 60) add('p', 'Additional declarations omitted.', block);
	}
	if (info.truncated) add('p', 'Showing the first 24 matching blocks; additional matches omitted.');
	if (info.variables.length) {
		add('h4', 'Theme variables · editor context');
		for (const variable of info.variables) add('pre', `${variable.name}: ${variable.value}`);
		add(
			'p',
			'Resolved in the current editor theme, not a rendered component; ancestor overrides and conditional themes may differ.'
		);
	}
	for (const warning of info.warnings) add('p', warning);
	add(
		'p',
		'Loaded global CSS only, not unsaved component styles. These are authored rules, not cascade winners. Nested selectors use → for parent context. Direct CSSOM edits are picked up on re-hover (cache: up to 1 second).'
	);
	if (docs.length) {
		const links = add('p', '');
		for (const [label, href] of docs) {
			const link = add('a', label, links) as HTMLAnchorElement;
			link.href = href;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
		}
		add('p', 'Flowbite uses Tailwind utilities; it is not a separate universal class catalogue.');
	}
	return root;
}

/**
 * Installs hover discovery and a lifecycle-owned CSS index for markup/style
 * languages. CodeMirror invokes the source after a 300ms pointer dwell, not on
 * every move. Browser APIs are accessed only after the view is mounted.
 */
export function classHoverExtension(language: 'svelte' | 'html' | 'css'): Extension {
	const indexPlugin = ViewPlugin.define((view) => {
		const index = acquireClassCssIndex(view.dom.ownerDocument);
		return { index, destroy: () => index.release() };
	});
	return [
		indexPlugin,
		hoverTooltip(
			(view, pos, side) => {
				const token = classTokenAt(view.state, pos, side, language);
				if (!token) return null;
				const info = token.dynamic
					? undefined
					: view.plugin(indexPlugin)?.index.lookup(token.name, view.dom);
				return {
					pos: token.from,
					end: token.to,
					above: true,
					create: () => ({ dom: tooltipDom(view.dom.ownerDocument, token, info) })
				};
			},
			{ hideOnChange: true, hoverTime: 300 }
		),
		EditorView.baseTheme({
			'.cm-class-hover': {
				maxWidth: 'min(34rem, calc(100vw - 24px))',
				maxHeight: 'min(28rem, 65vh)',
				overflow: 'auto',
				padding: '12px 14px',
				fontFamily: 'system-ui, sans-serif',
				fontSize: '12px',
				lineHeight: '1.5',
				overflowWrap: 'anywhere'
			},
			'.cm-class-hover > strong': { fontSize: '14px' },
			'.cm-class-hover h4': { fontWeight: '650', margin: '14px 0 5px' },
			'.cm-class-hover p': { margin: '5px 0' },
			'.cm-class-hover section': { margin: '10px 0' },
			'.cm-class-hover pre': {
				fontFamily: 'ui-monospace, monospace',
				fontSize: '12px',
				whiteSpace: 'pre-wrap',
				margin: '5px 0',
				padding: '0',
				background: 'transparent',
				color: 'inherit',
				boxShadow: 'none'
			},
			'.cm-class-hover a': {
				color: 'inherit',
				textDecoration: 'underline',
				textUnderlineOffset: '2px',
				display: 'inline-block',
				marginRight: '12px'
			},
			'.cm-class-hover a:focus-visible': { outline: '2px solid currentColor', outlineOffset: '2px' }
		})
	];
}
