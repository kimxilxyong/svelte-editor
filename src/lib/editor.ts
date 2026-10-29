export type SectionKind = 'hero' | 'text' | 'button' | 'features' | 'image' | 'quote';
export type WidgetKind =
	| 'widget-button'
	| 'widget-text-field'
	| 'widget-textarea'
	| 'widget-checkbox'
	| 'widget-radio'
	| 'widget-switch'
	| 'widget-select'
	| 'widget-slider'
	| 'widget-badge'
	| 'widget-alert'
	| 'widget-progress'
	| 'widget-avatar'
	| 'widget-card'
	| 'widget-link';
export type BlockKind = SectionKind | WidgetKind;
export type Theme = 'light' | 'lavender' | 'dark';

export type BuilderBlock = {
	id: string;
	kind: BlockKind;
	title: string;
	body: string;
	action: string;
	theme: Theme;
	positioned: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
	value: string;
	checked: boolean;
	level: number;
	href: string;
	newTab: boolean;
};

export type EditorPage = {
	id: string;
	name: string;
	slug: string;
	width: number;
	height: number;
	blocks: BuilderBlock[];
};

export type EditorSite = { pages: EditorPage[] };

const blockKinds: BlockKind[] = [
	'hero',
	'text',
	'button',
	'features',
	'image',
	'quote',
	'widget-button',
	'widget-text-field',
	'widget-textarea',
	'widget-checkbox',
	'widget-radio',
	'widget-switch',
	'widget-select',
	'widget-slider',
	'widget-badge',
	'widget-alert',
	'widget-progress',
	'widget-avatar',
	'widget-card',
	'widget-link'
];
const themes: Theme[] = ['light', 'lavender', 'dark'];

export const canvasLimits = { minWidth: 320, maxWidth: 1600, minHeight: 300, maxHeight: 5000 };
const slugPattern = /^[a-z0-9-]{1,40}$/;

export function isValidLinkHref(href: string) {
	return (
		href === '' ||
		(href.length <= 200 &&
			(/^\/[a-z0-9\-_/#?=&.]*$/i.test(href) || /^https?:\/\/[^\s]+$/i.test(href)))
	);
}

export function parseBuilderBlocks(value: unknown): BuilderBlock[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;

	const ids = new Set<string>();
	const blocks: BuilderBlock[] = [];
	let nextFlowPosition = 40;

	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

		const block = item as Record<string, unknown>;
		const positioned = block.positioned ?? true;
		const x = block.x ?? 6;
		const y = block.y ?? 40;
		const width = block.width ?? 88;
		const height = block.height ?? 260;
		const value = block.value ?? '';
		const checked = block.checked ?? false;
		const level = block.level ?? 60;
		const href = block.href ?? '';
		const newTab = block.newTab ?? false;

		if (
			typeof block.id !== 'string' ||
			block.id.length === 0 ||
			block.id.length > 100 ||
			ids.has(block.id) ||
			typeof block.kind !== 'string' ||
			!blockKinds.includes(block.kind as BlockKind) ||
			typeof block.title !== 'string' ||
			block.title.length > 100 ||
			typeof block.body !== 'string' ||
			block.body.length > 240 ||
			typeof block.action !== 'string' ||
			block.action.length > 48 ||
			typeof block.theme !== 'string' ||
			!themes.includes(block.theme as Theme) ||
			typeof positioned !== 'boolean' ||
			typeof x !== 'number' ||
			!Number.isFinite(x) ||
			x < 0 ||
			x > 100 ||
			typeof y !== 'number' ||
			!Number.isFinite(y) ||
			y < 0 ||
			y > 5000 ||
			typeof width !== 'number' ||
			!Number.isFinite(width) ||
			width < 20 ||
			width > 100 ||
			x + width > 100 ||
			typeof height !== 'number' ||
			!Number.isFinite(height) ||
			height < 100 ||
			height > 1600 ||
			typeof value !== 'string' ||
			value.length > 100 ||
			typeof checked !== 'boolean' ||
			typeof level !== 'number' ||
			!Number.isFinite(level) ||
			level < 0 ||
			level > 100 ||
			typeof href !== 'string' ||
			!isValidLinkHref(href) ||
			typeof newTab !== 'boolean'
		) {
			return null;
		}

		const positionedY = positioned ? y : nextFlowPosition;
		ids.add(block.id);
		if (!positioned) nextFlowPosition = Math.min(5000, positionedY + height + 40);
		blocks.push({
			id: block.id,
			kind: block.kind as BlockKind,
			title: block.title,
			body: block.body,
			action: block.action,
			theme: block.theme as Theme,
			positioned: true,
			x,
			y: positionedY,
			width,
			height,
			value,
			checked,
			level,
			href,
			newTab
		});
	}

	return blocks;
}

export function parseEditorSite(value: unknown): EditorSite | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const pagesValue = (value as Record<string, unknown>).pages;
	if (!Array.isArray(pagesValue) || pagesValue.length < 1 || pagesValue.length > 20) return null;

	const ids = new Set<string>();
	const slugs = new Set<string>();
	const pages: EditorPage[] = [];

	for (const item of pagesValue) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
		const page = item as Record<string, unknown>;
		const blocks = parseBuilderBlocks(page.blocks);

		if (
			!blocks ||
			typeof page.id !== 'string' ||
			page.id.length === 0 ||
			page.id.length > 100 ||
			ids.has(page.id) ||
			typeof page.name !== 'string' ||
			page.name.trim().length === 0 ||
			page.name.length > 40 ||
			typeof page.slug !== 'string' ||
			!slugPattern.test(page.slug) ||
			slugs.has(page.slug) ||
			typeof page.width !== 'number' ||
			!Number.isFinite(page.width) ||
			page.width < canvasLimits.minWidth ||
			page.width > canvasLimits.maxWidth ||
			typeof page.height !== 'number' ||
			!Number.isFinite(page.height) ||
			page.height < canvasLimits.minHeight ||
			page.height > canvasLimits.maxHeight
		) {
			return null;
		}

		ids.add(page.id);
		slugs.add(page.slug);
		pages.push({
			id: page.id,
			name: page.name,
			slug: page.slug,
			width: page.width,
			height: page.height,
			blocks
		});
	}

	return { pages };
}

// Component file names (without .svelte) in src/lib/components/editor/ for each block kind.
export const componentNames: Record<BlockKind, string> = {
	hero: 'Hero',
	text: 'TextSection',
	button: 'ButtonSection',
	features: 'Features',
	image: 'ImageSection',
	quote: 'Quote',
	'widget-button': 'WidgetButton',
	'widget-text-field': 'WidgetTextField',
	'widget-textarea': 'WidgetTextarea',
	'widget-checkbox': 'WidgetCheckbox',
	'widget-radio': 'WidgetRadio',
	'widget-switch': 'WidgetSwitch',
	'widget-select': 'WidgetSelect',
	'widget-slider': 'WidgetSlider',
	'widget-badge': 'WidgetBadge',
	'widget-alert': 'WidgetAlert',
	'widget-progress': 'WidgetProgress',
	'widget-avatar': 'WidgetAvatar',
	'widget-card': 'WidgetCard',
	'widget-link': 'WidgetLink'
};
