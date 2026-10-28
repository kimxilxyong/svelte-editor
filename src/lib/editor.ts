export type BlockKind = 'hero' | 'text' | 'button' | 'features' | 'image' | 'quote';
export type Theme = 'light' | 'lavender' | 'dark';

export type BuilderBlock = {
	id: string;
	kind: BlockKind;
	title: string;
	body: string;
	action: string;
	theme: Theme;
};

const blockKinds: BlockKind[] = ['hero', 'text', 'button', 'features', 'image', 'quote'];
const themes: Theme[] = ['light', 'lavender', 'dark'];

export function parseBuilderBlocks(value: unknown): BuilderBlock[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;

	const ids = new Set<string>();
	const blocks: BuilderBlock[] = [];

	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

		const block = item as Record<string, unknown>;
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
			!themes.includes(block.theme as Theme)
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
			theme: block.theme as Theme
		});
	}

	return blocks;
}
