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
	type BlockKind,
	type BuilderBlock,
	type EditorPage
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
	'title' | 'body' | 'action' | 'theme' | 'value' | 'checked' | 'level' | 'href' | 'newTab';

const sectionProps: PropName[] = ['title', 'body', 'theme'];

/**
 * Prop attribute whitelist mapping for each built-in block kind.
 */
const kindProps: Record<BlockKind, PropName[]> = {
	hero: ['title', 'body', 'action', 'theme'],
	text: sectionProps,
	button: ['title', 'body', 'action', 'theme'],
	features: sectionProps,
	image: sectionProps,
	quote: ['title', 'body', 'action', 'theme'],
	'widget-button': ['body', 'action'],
	'widget-text-field': ['title', 'body', 'action', 'value'],
	'widget-textarea': ['title', 'body', 'action', 'value'],
	'widget-checkbox': ['title', 'body', 'checked'],
	'widget-radio': ['title', 'body', 'checked'],
	'widget-switch': ['title', 'body', 'checked'],
	'widget-select': ['title', 'body', 'value'],
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
		.map((block) => {
			const name = getComponentName(block.kind);
			let propsStr = '';
			if (block.kind.startsWith('custom:')) {
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
				const allowed = kindProps[block.kind as keyof typeof kindProps] || [];
				propsStr = allowed.map((prop) => renderProp(block, prop)).join(' ');
			}
			return `\t\t<div\n\t\t\tclass="editor-block"\n\t\t\tstyle="left: ${block.x}%; top: ${block.y}px; width: ${block.width}%; height: ${block.height}px"\n\t\t>\n\t\t\t<${name}${propsStr ? ' ' + propsStr : ''} />\n\t\t</div>`;
		})
		.join('\n');

	return `${generatedMarker}
<script lang="ts">
${imports}
</script>

<svelte:head>
	<title>${escapeText(page.name)}</title>
</svelte:head>

<div
	class="editor-page"
	data-editor-page="${escapeAttribute(page.name)}"
	style="width: ${page.width}px; min-height: ${pageHeight(page)}px"
>
${blocks}
</div>

<style>
	.editor-page {
		position: relative;
		max-width: 100%;
		margin-inline: auto;
		overflow: hidden;
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
 * Reconstructs an EditorPage instance from an exported `+page.svelte` source file.
 *
 * Returns `null` if the source is not an editor-generated page, contains syntax errors,
 * or fails validation constraints.
 *
 * @param source - File contents of `+page.svelte`.
 * @param slug - Route slug associated with this file.
 * @returns Parsed EditorPage model or `null`.
 */
export function parsePageSource(source: string, slug: string): EditorPage | null {
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
		const kind: BlockKind = isStandard
			? kindByComponent.get(component.name!)!
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
				} else if (!isStandard) {
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
			x: wrapperStyle.left,
			y: wrapperStyle.top,
			width: wrapperStyle.width,
			height: wrapperStyle.height,
			...props,
			...(Object.keys(customProps).length > 0 ? { customProps } : {})
		});
	}

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
