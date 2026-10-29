import { parse } from 'svelte/compiler';
import {
	componentNames,
	getComponentName,
	parseBuilderBlocks,
	type BlockKind,
	type BuilderBlock,
	type EditorPage
} from './editor.js';

export const generatedMarker =
	'<!-- @svelte-editor generated — re-exporting overwrites this file -->';
export const componentImportBase = '$lib/components/editor';

type PropName =
	'title' | 'body' | 'action' | 'theme' | 'value' | 'checked' | 'level' | 'href' | 'newTab';

const sectionProps: PropName[] = ['title', 'body', 'theme'];
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

const kindByComponent = new Map(
	Object.entries(componentNames).map(([kind, name]) => [name, kind as BlockKind])
);

export function usedComponentNames(pages: EditorPage[]) {
	return [
		...new Set(pages.flatMap((page) => page.blocks.map((block) => getComponentName(block.kind))))
	];
}

function escapeAttribute(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;');
}

function renderProp(block: BuilderBlock, prop: PropName) {
	const value = block[prop];
	if (typeof value === 'string') return `${prop}="${escapeAttribute(value)}"`;
	return `${prop}={${value}}`;
}

export function pageHeight(page: EditorPage) {
	return Math.max(page.height, ...page.blocks.map((block) => block.y + block.height + 40));
}

export function renderPageSource(page: EditorPage) {
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

function escapeText(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;');
}

type AstNode = {
	type: string;
	name?: string;
	attributes?: AstAttribute[];
	fragment?: { nodes: AstNode[] };
};
type AstAttribute = { type: string; name: string; value: true | AstValue | AstValue[] };
type AstValue = { type: string; data?: string; expression?: { type: string; value?: unknown } };

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

function elementNodes(nodes: AstNode[]) {
	return nodes.filter((node) => node.type === 'RegularElement' || node.type === 'Component');
}

function readStyle(style: string) {
	const values: Record<string, number> = {};
	for (const part of style.split(';')) {
		const [key, raw] = part.split(':');
		const number = Number.parseFloat(raw ?? '');
		if (key && Number.isFinite(number)) values[key.trim()] = number;
	}
	return values;
}

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
 * Reads a +page.svelte that was exported by this editor back into a page.
 * Returns null for files that are not editor pages or fail validation.
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
