import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentNames, parseBuilderBlocks, type WidgetKind } from './editor.js';
import { filterWidgets, widgetCatalog, widgetCategories } from './widget-catalog.js';

const kinds = Object.keys(widgetCatalog) as WidgetKind[];

describe('widget catalog', () => {
	it('covers every widget kind with a component file and valid category', () => {
		const widgetNames = Object.keys(componentNames).filter((kind) => kind.startsWith('widget-'));
		expect(kinds.sort()).toEqual(widgetNames.sort());
		expect(kinds.length).toBeGreaterThanOrEqual(14);
		for (const kind of kinds) {
			expect(widgetCategories).toContain(widgetCatalog[kind].category);
			const file = path.join('src/lib/components/editor', `${componentNames[kind]}.svelte`);
			expect(existsSync(file), file).toBe(true);
		}
	});

	it('produces defaults that pass block validation', () => {
		const blocks = kinds.map((kind, index) => {
			const { title, body, action, items, level, width, height, theme } =
				widgetCatalog[kind].defaults;
			return {
				id: `b${index}`,
				kind,
				title,
				body,
				action,
				theme: theme ?? 'light',
				positioned: true,
				x: 24,
				y: 24,
				width,
				height,
				value: '',
				checked: false,
				level: level ?? 60,
				href: '',
				newTab: false,
				...(items ? { items } : {})
			};
		});
		expect(parseBuilderBlocks(blocks)).toHaveLength(kinds.length);
	});

	it('keeps default widget sizes compact (pixels)', () => {
		for (const kind of kinds) {
			const { width, height } = widgetCatalog[kind].defaults;
			expect(width, kind).toBeLessThanOrEqual(300);
			expect(height, kind).toBeLessThanOrEqual(140);
		}
	});

	it('filters by label, description and category', () => {
		expect(filterWidgets(kinds, 'slider')).toContain('widget-slider');
		expect(filterWidgets(kinds, 'feedback')).toContain('widget-alert');
		expect(filterWidgets(kinds, 'zzzz')).toEqual([]);
		expect(filterWidgets(kinds, '  ')).toEqual(kinds);
	});
});
