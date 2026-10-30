import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BlockContent from './BlockContent.svelte';
import { widgetCatalog } from '../widget-catalog.js';
import type { BuilderBlock, WidgetKind } from '../editor.js';

/** Builds a block the way the editor does when a widget is dropped onto the canvas. */
function dropped(kind: WidgetKind): BuilderBlock {
	const { title, body, action, items, level, theme } = widgetCatalog[kind].defaults;
	return {
		id: `block-${kind}`,
		kind,
		title,
		body,
		action,
		theme: theme ?? 'light',
		positioned: true,
		x: 6,
		y: 40,
		width: 88,
		height: 260,
		value: '',
		checked: false,
		level: level ?? 60,
		href: '/home',
		newTab: false,
		...(items ? { items } : {})
	};
}

describe('BlockContent with Flowbite widgets', () => {
	for (const kind of Object.keys(widgetCatalog) as WidgetKind[]) {
		it(`renders ${kind} with catalog defaults`, async () => {
			const { container } = render(BlockContent, { block: dropped(kind) });
			expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
		});
	}
});
