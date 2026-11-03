/**
 * @fileoverview Base CSS generation for native Svelte source. The compiler AST is
 * inspected, never compiled or executed. A disposable, scriptless iframe samples
 * the application's loaded CSS, without the component's own style block or the
 * editor's inherited styles. Only curated, non-geometric properties are exported.
 *
 * This is a static/current-viewport aid, not a component renderer: expressions,
 * component imports, snippets, SVG and raw HTML are not evaluated. Branches and
 * each bodies contribute one static representative. Rules are appended in the
 * base cascade layer so utility hover/dark/responsive rules continue to win.
 */
import { parse, parseCss, type AST } from 'svelte/compiler';

/** Safe, static native element description; no executable or resource attributes. */
export interface BaseCssElement {
	tag: string;
	attributes: Record<string, string>;
	/** Literal text only; retained so selectors such as `:empty` remain meaningful. */
	text: string;
	children: BaseCssElement[];
}

/** Static extraction result, including limitations to surface in the editor status. */
export interface BaseCssPlan {
	elements: BaseCssElement[];
	warnings: string[];
}

/** Generation result. `css` preserves the input CSS byte-for-byte as its prefix. */
export interface BaseCssResult {
	css: string;
	added: number;
	warnings: string[];
}

// An allowlist prevents custom-element constructors, embedded browsing contexts,
// metadata, SVG external references and resource loading, even before CSP applies.
const nativeTags = new Set(
	(
		'a abbr address article aside b bdi bdo blockquote br button caption cite code col ' +
		'colgroup data datalist dd del details dfn dialog div dl dt em fieldset figcaption ' +
		'figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label ' +
		'legend li main mark menu meter nav ol optgroup option output p picture pre progress ' +
		'q rp rt ruby s samp search section select small span strong sub summary sup table ' +
		'tbody td textarea tfoot th thead time tr u ul var wbr'
	).split(' ')
);
const sampleAttributes = new Set([
	'id',
	'class',
	'type',
	'role',
	'dir',
	'lang',
	'disabled',
	'checked',
	'multiple',
	'readonly',
	'required',
	'open',
	'placeholder'
]);

/** Tailwind variants must not leak their currently-active values into base rules. */
function isVariantClass(token: string): boolean {
	let brackets = 0;
	for (const character of token) {
		if (character === '[') brackets++;
		else if (character === ']') brackets--;
		else if (character === ':' && brackets === 0) return true;
	}
	return false;
}

/** Extracts only complete static class tokens, not fragments such as `btn-{size}`. */
function staticClasses(value: AST.Attribute['value']): string {
	if (!Array.isArray(value)) return '';
	const tokens: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const chunk = value[i];
		if (chunk.type !== 'Text') continue;
		const matches = chunk.data.matchAll(/\S+/g);
		for (const match of matches) {
			const start = match.index;
			const end = start + match[0].length;
			if (start === 0 && i > 0) continue;
			if (end === chunk.data.length && i < value.length - 1) continue;
			tokens.push(match[0]);
		}
	}
	return [...new Set(tokens)].sort().join(' ');
}

/**
 * Extracts static native markup without evaluating scripts, handlers or expressions.
 * Invalid Svelte throws a compiler parse error; there is no guessed fallback.
 */
export function extractBaseCssElements(source: string): BaseCssPlan {
	const root = parse(source, { modern: true });
	const warnings = new Set<string>();
	let count = 0;
	function fragment(part: AST.Fragment | null | undefined): BaseCssElement[] {
		return part?.nodes.flatMap(node) ?? [];
	}
	function node(item: AST.Fragment['nodes'][number]): BaseCssElement[] {
		switch (item.type) {
			case 'RegularElement': {
				if (!nativeTags.has(item.name)) {
					warnings.add('Custom elements, SVG and embedded content were skipped.');
					return [];
				}
				if (++count > 500) throw new Error('Base CSS supports at most 500 static elements.');
				const attributes: Record<string, string> = {};
				for (const attr of item.attributes) {
					if (attr.type !== 'Attribute') {
						warnings.add('Dynamic attributes and directives were not evaluated.');
						continue;
					}
					if (
						!sampleAttributes.has(attr.name) &&
						!attr.name.startsWith('aria-') &&
						!attr.name.startsWith('data-')
					)
						continue;
					if (attr.name === 'class') {
						const classes = staticClasses(attr.value);
						if (classes) attributes.class = classes;
					} else if (attr.value === true) {
						attributes[attr.name] = '';
					} else if (Array.isArray(attr.value) && attr.value.every((v) => v.type === 'Text')) {
						attributes[attr.name] = attr.value
							.map((v) => (v.type === 'Text' ? v.data : ''))
							.join('');
					}
					if (
						attr.value !== true &&
						(!Array.isArray(attr.value) || attr.value.some((v) => v.type !== 'Text'))
					) {
						warnings.add('Dynamic attributes and directives were not evaluated.');
					}
				}
				return [
					{
						tag: item.name,
						attributes,
						text: item.fragment.nodes
							.filter((child) => child.type === 'Text')
							.map((child) => child.data)
							.join(''),
						children: fragment(item.fragment)
					}
				];
			}
			case 'IfBlock':
				warnings.add('Branches and loops use static representatives, not runtime state.');
				return [...fragment(item.consequent), ...fragment(item.alternate)];
			case 'EachBlock':
				warnings.add('Branches and loops use static representatives, not runtime state.');
				return [...fragment(item.body), ...fragment(item.fallback)];
			case 'AwaitBlock':
				warnings.add('Branches and loops use static representatives, not runtime state.');
				return [...fragment(item.pending), ...fragment(item.then), ...fragment(item.catch)];
			case 'KeyBlock':
			case 'SvelteBoundary':
				return fragment(item.fragment);
			case 'Text':
			case 'Comment':
				return [];
			case 'ExpressionTag':
				return [];
			default:
				warnings.add('Imported components, snippets and dynamic HTML were skipped.');
				return [];
		}
	}
	return { elements: fragment(root.fragment), warnings: [...warnings] };
}

/** Decodes CSS identifier escapes for semantic comparison, never for CSS output. */
function unescapeIdentifier(name: string): string {
	return name.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_, escaped: string) => {
		const hex = /^[0-9a-f]{1,6}\s?$/i.test(escaped);
		const code = hex ? Number.parseInt(escaped.trim(), 16) : 0;
		return hex ? String.fromCodePoint(code === 0 || code > 0x10ffff ? 0xfffd : code) : escaped;
	});
}

/**
 * Reads selector ownership with the Svelte CSS AST (groups, nesting, at-rules and
 * :global included). Keys are comparison-only strings, not executable selectors.
 * Existing conditional rules count as owned too: generation never fills over them.
 */
export function existingBaseCssSelectors(css: string): Set<string> {
	const ast = parseCss(css);
	const found = new Set<string>();
	function selector(part: AST.CSS.ComplexSelector, parent: string): string[] {
		let results = [''];
		for (const [index, relative] of part.children.entries()) {
			const prefix = relative.combinator?.name ?? (index ? ' ' : '');
			results = results.map((text) => text + prefix);
			// Class order does not change a compound selector's meaning.
			const simples = [...relative.selectors];
			if (simples.every((s) => ['TypeSelector', 'IdSelector', 'ClassSelector'].includes(s.type))) {
				simples.sort((a, b) => {
					if (a.type === 'TypeSelector') return -1;
					if (b.type === 'TypeSelector') return 1;
					return css.slice(a.start, a.end).localeCompare(css.slice(b.start, b.end));
				});
			}
			for (const simple of simples) {
				let values: string[];
				if (simple.type === 'NestingSelector') values = [parent];
				else if (simple.type === 'ClassSelector') values = ['.' + unescapeIdentifier(simple.name)];
				else if (simple.type === 'IdSelector') values = ['#' + unescapeIdentifier(simple.name)];
				else if (simple.type === 'TypeSelector') values = [simple.name];
				else if (simple.type === 'PseudoClassSelector' && simple.name === 'global') {
					values = simple.args?.children.flatMap((child) => selector(child, parent)) ?? [''];
				} else values = [css.slice(simple.start, simple.end)];
				results = results.flatMap((text) => values.map((value) => text + value));
			}
		}
		return results.map((text) => text.trim());
	}
	function hasNesting(part: AST.CSS.ComplexSelector): boolean {
		return part.children.some((relative) =>
			relative.selectors.some(
				(simple) =>
					simple.type === 'NestingSelector' ||
					(simple.type === 'PseudoClassSelector' &&
						simple.name === 'global' &&
						simple.args?.children.some(hasNesting))
			)
		);
	}
	function visit(
		children: (AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration)[],
		parents: string[]
	) {
		for (const child of children) {
			if (child.type === 'Rule') {
				const resolved = parents.flatMap((parent) =>
					child.prelude.children.flatMap((part) =>
						selector(part, parent).map((own) =>
							parent && own && !hasNesting(part) ? `${parent} ${own}` : own || parent
						)
					)
				);
				for (const name of resolved) if (name) found.add(name);
				visit(child.block.children, resolved);
			} else if (child.type === 'Atrule' && child.block && !child.name.endsWith('keyframes')) {
				visit(child.block.children, parents);
			}
		}
	}
	visit(ast.children, ['']);
	return found;
}

/** Curated defaults: no measured width/height, offsets or resolved grid tracks. */
const properties = [
	'box-sizing',
	'display',
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'line-height',
	'letter-spacing',
	'text-align',
	'text-transform',
	'text-decoration-line',
	'color',
	'background-color',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-top-style',
	'border-right-style',
	'border-bottom-style',
	'border-left-style',
	'border-top-color',
	'border-right-color',
	'border-bottom-color',
	'border-left-color',
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-right-radius',
	'border-bottom-left-radius',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'flex-direction',
	'flex-wrap',
	'flex-grow',
	'flex-shrink',
	'align-items',
	'align-self',
	'justify-content',
	'row-gap',
	'column-gap',
	'opacity',
	'box-shadow'
] as const;

/** Serializes already-loaded sheets; fail closed if defaults cannot be inspected. */
function loadedCss(owner: Document): string {
	function rules(sheet: CSSStyleSheet): string {
		return [...sheet.cssRules]
			.map((rule) => {
				// Do not copy @import URLs into the sampler; recurse into the loaded sheet.
				if (rule.type === 3) {
					const imported = rule as CSSImportRule;
					if (!imported.styleSheet) throw new Error('An imported stylesheet is not loaded.');
					const content = rules(imported.styleSheet);
					return imported.media.mediaText
						? `@media ${imported.media.mediaText} {${content}}`
						: content;
				}
				return rule.cssText;
			})
			.join('\n');
	}
	try {
		const sheets = [...owner.styleSheets, ...owner.adoptedStyleSheets].filter(
			(sheet) => !sheet.disabled
		);
		if (!sheets.length) throw new Error('No global stylesheets are loaded.');
		const content = sheets
			.map((sheet) => {
				const content = rules(sheet);
				return sheet.media?.mediaText ? `@media ${sheet.media.mediaText} {${content}}` : content;
			})
			.join('\n');
		if (!content.trim()) throw new Error('The global stylesheets are empty.');
		return content;
	} catch (error) {
		throw new Error(
			'Could not read the loaded global CSS. Check stylesheet loading and same-origin access.',
			{ cause: error }
		);
	}
}

/**
 * Generates append-only base-layer rules from the loaded global Tailwind/Flowbite
 * defaults. The iframe has no scripts or resource access. Every temporary resource
 * is removed in `finally`, including parse, load and sampling failures.
 *
 * Rules represent the current viewport's static, unfocused state. Utilities not
 * present in the loaded build cannot be invented; project-specific stylesheets
 * are not fetched. Shared selectors receive only values common to all matches.
 */
export async function generateBaseCss(
	source: string,
	existingCss: string,
	ownerDocument: Document = document
): Promise<BaseCssResult> {
	const plan = extractBaseCssElements(source);
	const existing = existingBaseCssSelectors(existingCss);
	if (!plan.elements.length)
		throw new Error(
			'No static native elements found. Imported components and dynamic HTML cannot be sampled.'
		);
	const css = loadedCss(ownerDocument);
	const iframe = ownerDocument.createElement('iframe');
	iframe.dataset.baseCssSampler = '';
	iframe.title = 'Temporary Base CSS sampler';
	iframe.setAttribute('aria-hidden', 'true');
	iframe.tabIndex = -1;
	iframe.sandbox.add('allow-same-origin');
	iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${ownerDocument.defaultView?.innerWidth ?? 1024}px;height:${ownerDocument.defaultView?.innerHeight ?? 768}px;visibility:hidden;pointer-events:none;border:0`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			iframe.onload = () => resolve();
			iframe.onerror = () => reject(new Error('The Base CSS sampler could not load.'));
			timer = setTimeout(() => reject(new Error('The Base CSS sampler timed out.')), 5000);
			iframe.srcdoc =
				'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';"><title>Base CSS</title></head><body></body></html>';
			ownerDocument.body.append(iframe);
		});
		const doc = iframe.contentDocument;
		const win = iframe.contentWindow;
		if (!doc || !win) throw new Error('The Base CSS sampler is unavailable.');
		const style = doc.createElement('style');
		style.textContent =
			css + '\n*, *::before, *::after { animation: none !important; transition: none !important; }';
		doc.head.append(style);
		const elements: Element[] = [];
		const build = (items: BaseCssElement[], parent: Element): void => {
			for (const item of items) {
				const el = doc.createElement(item.tag);
				for (const [name, value] of Object.entries(item.attributes)) {
					// Keep only unconditional classes in the static baseline. Otherwise a
					// desktop md:flex could become an unconditional mobile display:flex.
					el.setAttribute(
						name,
						name === 'class'
							? value
									.split(/\s+/)
									.filter((token) => !isVariantClass(token))
									.join(' ')
							: value
					);
				}
				if (item.text) el.append(doc.createTextNode(item.text));
				parent.append(el);
				elements.push(el);
				build(item.children, el);
			}
		};
		build(plan.elements, doc.body);
		const escape = ownerDocument.defaultView?.CSS.escape;
		if (!escape) throw new Error('CSS selector escaping is not supported in this browser.');
		const selectors = new Map<string, string>();
		for (const el of elements) {
			const id = el.getAttribute('id');
			const classes = [...el.classList].sort();
			let selector = id
				? `#${escape(id)}`
				: classes.length
					? classes.map((name) => `.${escape(name)}`).join('')
					: el.localName;
			// A class combination shared by different tags is not a safe style owner.
			if (
				!id &&
				classes.length &&
				elements.some((other) => other.localName !== el.localName && other.matches(selector))
			) {
				selector = el.localName + selector;
			}
			const key = [...existingBaseCssSelectors(`${selector} {}`)][0];
			if (!existing.has(key)) selectors.set(selector, key);
		}
		const computed = new Map(
			elements.map((el) => {
				const values = win.getComputedStyle(el);
				return [
					el,
					new Map(
						properties.map((property) => [property, values.getPropertyValue(property).trim()])
					)
				];
			})
		);
		const rules: string[] = [];
		for (const selector of selectors.keys()) {
			const matches = elements.filter((el) => el.matches(selector));
			const declarations = properties.flatMap((property) => {
				const value = computed.get(matches[0])?.get(property);
				// Never export resource URLs or active animation values. Only common
				// defaults are safe when an element-selector also matches styled peers.
				if (
					!value ||
					/url\s*\(/i.test(value) ||
					!matches.every((el) => computed.get(el)?.get(property) === value)
				)
					return [];
				return [`\t\t${property}: ${value};`];
			});
			if (declarations.length) rules.push(`\t${selector} {\n${declarations.join('\n')}\n\t}`);
		}
		const warnings = [
			...plan.warnings,
			'Static defaults at the current viewport only; variant classes are excluded so hover, dark and responsive styles stay in utilities. Only loaded styles are available.'
		];
		if (!rules.length) return { css: existingCss, added: 0, warnings };
		const separator = existingCss
			? existingCss.endsWith('\n\n')
				? ''
				: existingCss.endsWith('\n')
					? '\n'
					: '\n\n'
			: '';
		return {
			css:
				existingCss +
				separator +
				'/* Base CSS: global defaults, not component styles. */\n@layer base {\n' +
				rules.join('\n\n') +
				'\n}\n',
			added: rules.length,
			warnings
		};
	} finally {
		clearTimeout(timer);
		iframe.onload = null;
		iframe.onerror = null;
		iframe.remove();
	}
}
