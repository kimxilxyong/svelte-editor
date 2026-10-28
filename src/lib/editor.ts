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
	| 'widget-card';
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
};

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
	'widget-card'
];
const themes: Theme[] = ['light', 'lavender', 'dark'];

export function parseBuilderBlocks(value: unknown): BuilderBlock[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;

	const ids = new Set<string>();
	const blocks: BuilderBlock[] = [];

	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

		const block = item as Record<string, unknown>;
		const positioned = block.positioned ?? false;
		const x = block.x ?? 6;
		const y = block.y ?? 40;
		const width = block.width ?? 88;
		const height = block.height ?? 260;
		const value = block.value ?? '';
		const checked = block.checked ?? false;
		const level = block.level ?? 60;

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
			level > 100
		) {
			return null;
		}

		ids.add(block.id);
		blocks.push({
			id: block.id,
			kind: block.kind as BlockKind,
			title: block.title,
			body: block.body,
			action: block.action,
			theme: block.theme as Theme,
			positioned,
			x,
			y,
			width,
			height,
			value,
			checked,
			level
		});
	}

	return blocks;
}
