/**
 * @fileoverview SvelteKit Page Generator and AST-Based Importer.
 *
 * Provides bidirectional round-trip transformation between in-memory `EditorPage`
 * data models and clean, idiomatic, compilable SvelteKit `+page.svelte` source files:
 *
 * 1. Generator (`renderPageSource`):
 *    - Emits a safety marker comment header `<!-- @svelte-editor generated ... -->`.
 *    - Gathers all unique component dependencies across standard and custom blocks.
 *    - Emits TypeScript `<script>` with imports pointing to `$lib/components/editor/<Name>.svelte`.
 *    - Renders `<svelte:head><title>...</title></svelte:head>`.
 *    - Wraps components in absolute-positioned containers styled with percentage coordinates.
 *
 * 2. Importer (`parsePageSource`):
 *    - Parses `+page.svelte` using `svelte/compiler` `parse({ modern: true })`.
 *    - Inspects the DOM tree for `data-editor-page` container attribute.
 *    - Extracts page dimensions from the inline style attributes.
 *    - Extracts component instances, matching standard components by name or mapping
 *      unrecognized components to dynamic `custom:<Name>` kinds with `customProps`.
 */

import { parse } from 'svelte/compiler';
import {
	componentNames,
	getComponentName,
	parseBuilderBlocks,
	compositeKind,
	type BlockKind,
	type BuilderBlock,
	type EditorComposite,
	type EditorPage,
	type WidgetKind
} from './editor.js';

/**
 * Marker comment prepended to all editor-generated files.
 * The exporter checks this marker to ensure hand-written files are never overwritten.
 */
export const generatedMarker =
	'<!-- @svelte-editor generated — re-exporting overwrites this file -->';

/** Base alias path where exported components reside in target projects. */
export const componentImportBase = '$lib/components/editor';

/** Allowed property names recognized on built-in builder blocks. */
type PropName =
	| 'title'
	| 'body'
	| 'action'
	| 'theme'
	| 'value'
	| 'checked'
	| 'level'
	| 'href'
	| 'newTab'
	| 'items';

/**
 * Prop attribute whitelist mapping for each built-in widget kind.
 */
const kindProps: Record<WidgetKind, PropName[]> = {
	'widget-button': ['body', 'action'],
	'widget-text-field': ['title', 'body', 'action', 'value'],
	'widget-textarea': ['title', 'body', 'action', 'value'],
	'widget-checkbox': ['title', 'body', 'checked'],
	'widget-radio': ['title', 'body', 'checked'],
	'widget-switch': ['title', 'body', 'checked'],
	'widget-select': ['title', 'body', 'value', 'items'],
	'widget-slider': ['title', 'body', 'level'],
	'widget-badge': ['title', 'body'],
	'widget-alert': ['title', 'body'],
	'widget-progress': ['title', 'body', 'level'],
	'widget-avatar': ['title', 'body'],
	'widget-card': ['title', 'body', 'action'],
	'widget-link': ['title', 'body', 'href', 'newTab']
};

/** Reverse lookup map: Component PascalCase Name -> BlockKind. */
const kindByComponent = new Map(
	Object.entries(componentNames).map(([kind, name]) => [name, kind as BlockKind])
);

/**
 * Retrieves the unique list of component PascalCase names required by an array of pages.
 *
 * @param pages - Collection of EditorPages to inspect.
 * @returns Deduplicated array of component names.
 */
export function usedComponentNames(pages: EditorPage[]): string[] {
	return [
		...new Set(pages.flatMap((page) => page.blocks.map((block) => getComponentName(block.kind))))
	];
}

/**
 * Escapes HTML/Svelte attribute special characters to prevent template injection.
 */
function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;');
}

/**
 * Renders a typed property into a valid Svelte attribute assignment (e.g. `prop="val"` or `prop={123}`).
 */
function renderProp(block: BuilderBlock, prop: PropName): string {
	const value = block[prop];
	if (value === undefined) return `${prop}=""`;
	if (typeof value === 'string') return `${prop}="${escapeAttribute(value)}"`;
	return `${prop}={${value}}`;
}

/**
 * Calculates the required minimum canvas height for an EditorPage based on its blocks.
 *
 * @param page - Target page.
 * @returns Height in pixels accommodating the lowest block plus margin.
 */
export function pageHeight(page: EditorPage): number {
	return Math.max(page.height, ...page.blocks.map((block) => block.y + block.height + 40));
}

/**
 * Generates compilable SvelteKit `+page.svelte` file content from an EditorPage definition.
 *
 * @param page - EditorPage to serialize.
 * @returns Formatted Svelte 5 component source code.
 */
export function renderPageSource(page: EditorPage): string {
	const names = usedComponentNames([page]);
	const imports = names
		.map((name) => `\timport ${name} from '${componentImportBase}/${name}.svelte';`)
		.join('\n');
	const blocks = page.blocks
		.map((block) =>
			renderBlockElement(
				block,
				`left: ${block.x}px; top: ${block.y}px; width: ${block.width}px; height: ${block.height}px`
			)
		)
		.join('\n');

	return `${generatedMarker}
<script lang="ts">
${imports}
	import ThemeScope from '${componentImportBase}/ThemeScope.svelte';
	import { siteTheme } from '$lib/site-theme';
</script>

<svelte:head>
	<title>${escapeText(page.name)}</title>
</svelte:head>

<ThemeScope theme={siteTheme}>
	<div
		class="editor-page"
		data-editor-page="${escapeAttribute(page.name)}"
		style="width: ${page.width}px; min-height: ${pageHeight(page)}px"
	>
${blocks}
	</div>
</ThemeScope>

<style>
	.editor-page {
		position: relative;
		max-width: 100%;
		margin-inline: auto;
		overflow: hidden;
		background: var(--site-bg, #fff);
		color: var(--site-fg, inherit);
	}

	.editor-block {
		position: absolute;
		box-sizing: border-box;
	}
</style>
`;
}

/**
 * Renders one absolutely positioned block wrapper containing its component.
 *
 * @param block - Block to render (widget, composite or custom component).
 * @param geometry - Inline CSS declarations for left/top/width/height (px for pages, % for composites).
 */
function renderBlockElement(block: BuilderBlock, geometry: string): string {
	const name = getComponentName(block.kind);
	let propsStr = '';
	// Composites carry no per-instance props (propsStr stays empty): their file describes them.
	if (block.kind.startsWith('composite:')) {
		// no props
	} else if (block.kind.startsWith('custom:')) {
		const rendered: string[] = [];
		if (block.title) rendered.push(`title="${escapeAttribute(block.title)}"`);
		if (block.body) rendered.push(`body="${escapeAttribute(block.body)}"`);
		if (block.action) rendered.push(`action="${escapeAttribute(block.action)}"`);
		if (block.customProps) {
			for (const [k, v] of Object.entries(block.customProps)) {
				if (typeof v === 'string') rendered.push(`${k}="${escapeAttribute(v)}"`);
				else rendered.push(`${k}={${v}}`);
			}
		}
		propsStr = rendered.join(' ');
	} else {
		const allowed = kindProps[block.kind as WidgetKind] || [];
		propsStr = allowed.map((prop) => renderProp(block, prop)).join(' ');
	}
	return `\t\t<div\n\t\t\tclass="editor-block"\n\t\t\tstyle="${geometry}"\n\t\t>\n\t\t\t<${name}${propsStr ? ' ' + propsStr : ''} />\n\t\t</div>`;
}

/** Rounds to two decimals so percentage geometry stays readable in generated files. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Generates the `.svelte` source of a composite component.
 *
 * Children are positioned in percentages of the composite canvas, so an instance can be resized
 * freely on a page. The natural size is kept in `data-width` / `data-height` for re-import.
 *
 * @param composite - Composite to serialize.
 * @returns Formatted Svelte 5 component source, starting with {@link generatedMarker}.
 * @example
 * renderCompositeSource({ id: 'a', name: 'Hero', width: 720, height: 220, blocks: [] });
 */
export function renderCompositeSource(composite: EditorComposite): string {
	const names = [
		...new Set(
			composite.blocks
				.map((block) => getComponentName(block.kind))
				.filter((name) => name !== composite.name)
		)
	];
	const imports = names
		.map((name) => `\timport ${name} from '${componentImportBase}/${name}.svelte';`)
		.join('\n');
	const blocks = composite.blocks
		.map((block) =>
			renderBlockElement(
				block,
				`left: ${round2((block.x / composite.width) * 100)}%; top: ${round2((block.y / composite.height) * 100)}%; width: ${round2((block.width / composite.width) * 100)}%; height: ${round2((block.height / composite.height) * 100)}%`
			)
		)
		.join('\n');

	return `${generatedMarker}
${imports ? `<script lang="ts">\n${imports}\n</script>\n` : ''}
<div
	class="editor-composite"
	data-editor-composite="${escapeAttribute(composite.name)}"
	data-width="${composite.width}"
	data-height="${composite.height}"
>
${blocks}
</div>

<style>
	.editor-composite {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.editor-block {
		position: absolute;
		box-sizing: border-box;
	}
</style>
`;
}

/** Escapes text content for safe inclusion in title tags and text nodes. */
function escapeText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;');
}

/** Svelte AST node interfaces for type safety. */
type AstNode = {
	type: string;
	name?: string;
	attributes?: AstAttribute[];
	fragment?: { nodes: AstNode[] };
};
type AstAttribute = { type: string; name: string; value: true | AstValue | AstValue[] };
type AstValue = { type: string; data?: string; expression?: { type: string; value?: unknown } };

/**
 * Extracts raw or literal value from an AST attribute node.
 */
function attributeValue(attribute: AstAttribute): string | number | boolean | undefined {
	if (attribute.type !== 'Attribute') return undefined;
	if (attribute.value === true) return true;
	const parts = Array.isArray(attribute.value) ? attribute.value : [attribute.value];
	if (parts.length === 1 && parts[0].type === 'ExpressionTag') {
		const expression = parts[0].expression;
		if (expression?.type === 'Literal') return expression.value as string | number | boolean;
		return undefined;
	}
	if (parts.some((part) => part.type !== 'Text')) return undefined;
	return parts.map((part) => part.data ?? '').join('');
}

/** Filters AST children to elements and components only. */
function elementNodes(nodes: AstNode[]): AstNode[] {
	return nodes.filter((node) => node.type === 'RegularElement' || node.type === 'Component');
}

/** Parses CSS inline style declarations into a key-value dictionary of numeric values. */
function readStyle(style: string): Record<string, number> {
	const values: Record<string, number> = {};
	for (const part of style.split(';')) {
		const [key, raw] = part.split(':');
		const number = Number.parseFloat(raw ?? '');
		if (key && Number.isFinite(number)) values[key.trim()] = number;
	}
	return values;
}

/** Finds the container element carrying the `data-editor-page` attribute. */
function findPageElement(nodes: AstNode[]): AstNode | undefined {
	for (const node of nodes) {
		if (
			node.type === 'RegularElement' &&
			node.attributes?.some((a) => a.name === 'data-editor-page')
		) {
			return node;
		}
		const nested = node.fragment ? findPageElement(node.fragment.nodes) : undefined;
		if (nested) return nested;
	}
	return undefined;
}

/**
 * Reads the positioned block wrappers of a page or composite container.
 *
 * @param container - The `data-editor-page` / `data-editor-composite` element.
 * @param compositeNames - Names of known composites; matching components become `composite:` blocks.
 * @param scaleX - Multiplier converting the wrapper's horizontal values to pixels (1 for pages;
 *   canvas width / 100 for composites, whose geometry is stored in percent).
 * @param scaleY - Same for vertical values.
 */
function readBlocks(
	container: AstNode,
	compositeNames: ReadonlySet<string>,
	scaleX: number,
	scaleY: number
): Record<string, unknown>[] {
	const pageElement = container;
	const blocks: Record<string, unknown>[] = [];
	for (const wrapper of elementNodes(pageElement.fragment?.nodes ?? [])) {
		const wrapperStyle = readStyle(
			String(
				attributeValue(wrapper.attributes?.find((a) => a.name === 'style') as AstAttribute) ?? ''
			)
		);
		const component = elementNodes(wrapper.fragment?.nodes ?? []).find(
			(node) =>
				node.type === 'Component' &&
				(kindByComponent.has(node.name ?? '') || /^[A-Z][a-zA-Z0-9_]*$/.test(node.name ?? ''))
		);
		if (!component) continue;

		const isStandard = kindByComponent.has(component.name!);
		const isComposite = compositeNames.has(component.name!);
		const kind: BlockKind = isStandard
			? kindByComponent.get(component.name!)!
			: isComposite
				? compositeKind(component.name!)
				: (`custom:${component.name!}` as BlockKind);

		const props: Record<string, unknown> = {};
		const customProps: Record<string, string | number | boolean> = {};

		for (const attribute of component.attributes ?? []) {
			const value = attributeValue(attribute);
			if (value !== undefined) {
				if (
					isStandard &&
					kindProps[kind as keyof typeof kindProps]?.includes(attribute.name as PropName)
				) {
					props[attribute.name] = value;
				} else if (!isStandard && !isComposite) {
					if (['title', 'body', 'action'].includes(attribute.name) && typeof value === 'string') {
						props[attribute.name] = value;
					} else if (
						typeof value === 'string' ||
						typeof value === 'number' ||
						typeof value === 'boolean'
					) {
						customProps[attribute.name] = value;
					}
				}
			}
		}

		blocks.push({
			id: globalThis.crypto.randomUUID(),
			kind,
			title: '',
			body: '',
			action: '',
			theme: 'light',
			x: round2(wrapperStyle.left * scaleX),
			y: round2(wrapperStyle.top * scaleY),
			width: round2(wrapperStyle.width * scaleX),
			height: round2(wrapperStyle.height * scaleY),
			...props,
			...(Object.keys(customProps).length > 0 ? { customProps } : {})
		});
	}

	return blocks;
}

/**
 * Reconstructs an EditorPage instance from an exported `+page.svelte` source file.
 *
 * Returns `null` if the source is not an editor-generated page, contains syntax errors,
 * or fails validation constraints.
 *
 * @param source - File contents of `+page.svelte`.
 * @param slug - Route slug associated with this file.
 * @param compositeNames - Names of known composites; their components import as `composite:` blocks.
 * @returns Parsed EditorPage model or `null`.
 */
export function parsePageSource(
	source: string,
	slug: string,
	compositeNames: ReadonlySet<string> = new Set()
): EditorPage | null {
	let root: { fragment: { nodes: AstNode[] } };
	try {
		root = parse(source, { modern: true }) as unknown as typeof root;
	} catch {
		return null;
	}

	const pageElement = findPageElement(root.fragment.nodes);
	if (!pageElement?.attributes) return null;

	const attrs = new Map(pageElement.attributes.map((a) => [a.name, attributeValue(a)]));
	const name = attrs.get('data-editor-page');
	const style = readStyle(String(attrs.get('style') ?? ''));
	if (typeof name !== 'string' || !style.width || !style['min-height']) return null;

	const blocks = readBlocks(pageElement, compositeNames, 1, 1);
	const parsedBlocks = parseBuilderBlocks(blocks);
	if (!parsedBlocks) return null;

	return {
		id: globalThis.crypto.randomUUID(),
		name,
		slug,
		width: style.width,
		height: style['min-height'],
		blocks: parsedBlocks
	};
}

/** Finds the container element carrying the `data-editor-composite` attribute. */
function findCompositeElement(nodes: AstNode[]): AstNode | undefined {
	for (const node of nodes) {
		if (
			node.type === 'RegularElement' &&
			node.attributes?.some((a) => a.name === 'data-editor-composite')
		) {
			return node;
		}
		const nested = node.fragment ? findCompositeElement(node.fragment.nodes) : undefined;
		if (nested) return nested;
	}
	return undefined;
}

/**
 * Reconstructs an EditorComposite from a generated composite `.svelte` file.
 *
 * @param source - File contents of `<Name>.svelte`.
 * @param compositeNames - Names of all known composites (so nested composites resolve).
 * @returns The composite (with a fresh id), or `null` when the file is not a generated composite,
 *   does not parse, or fails validation.
 */
export function parseCompositeSource(
	source: string,
	compositeNames: ReadonlySet<string> = new Set()
): EditorComposite | null {
	let root: { fragment: { nodes: AstNode[] } };
	try {
		root = parse(source, { modern: true }) as unknown as typeof root;
	} catch {
		return null;
	}

	const element = findCompositeElement(root.fragment.nodes);
	if (!element?.attributes) return null;
	const attrs = new Map(element.attributes.map((a) => [a.name, attributeValue(a)]));
	const name = attrs.get('data-editor-composite');
	const width = Number(attrs.get('data-width'));
	const height = Number(attrs.get('data-height'));
	if (typeof name !== 'string' || !Number.isFinite(width) || !Number.isFinite(height)) return null;

	const blocks = parseBuilderBlocks(readBlocks(element, compositeNames, width / 100, height / 100));
	if (!blocks) return null;
	return { id: globalThis.crypto.randomUUID(), name, width, height, blocks };
}
