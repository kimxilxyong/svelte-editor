import { describe, expect, it } from 'vitest';
import { componentNames, type WidgetKind } from './editor.js';
import { inspectorFields } from './inspector-fields.js';
import { widgetCatalog } from './widget-catalog.js';

const kinds = Object.keys(componentNames) as WidgetKind[];

describe('inspectorFields capability map', () => {
	it('covers every built-in widget with at least one content control', () => {
		for (const kind of kinds) {
			const fields = inspectorFields(kind);
			expect(Object.keys(fields).length, kind).toBeGreaterThan(0);
			expect(kind in widgetCatalog).toBe(true);
		}
	});

	it('offers Link Navigation only on link, button and card', () => {
		const linkable = kinds.filter((kind) => inspectorFields(kind).link);
		expect(linkable.sort()).toEqual([
			'widget-button',
			'widget-card',
			'widget-gradient-button',
			'widget-link'
		]);
		expect(inspectorFields('widget-link').link).toEqual({ optional: false });
		expect(inspectorFields('widget-button').link).toEqual({ optional: true });
	});

	it('does not expose a title for the button, which never renders one', () => {
		const button = inspectorFields('widget-button');
		expect(button.title).toBeUndefined();
		expect(button.action).toBe('Button label');
		expect(button.body).toBe('Tooltip');
	});

	it('exposes nothing for composites and heading/description/props for imports', () => {
		expect(inspectorFields('composite:Hero')).toEqual({});
		expect(inspectorFields('custom:Newsletter')).toEqual({
			title: 'Heading',
			body: 'Description',
			customProps: true
		});
	});

	it('maps state controls to the widgets that use them', () => {
		expect(inspectorFields('widget-switch').checked).toBe(true);
		expect(inspectorFields('widget-select').selectedOption).toBe(true);
		expect(inspectorFields('widget-select').items).toBeTruthy();
		expect(inspectorFields('widget-slider').level).toBe(true);
		expect(inspectorFields('widget-progress').level).toBe(true);
		expect(inspectorFields('widget-badge').level).toBeUndefined();
		expect(inspectorFields('widget-text-field').action).toBe('Placeholder');
	});
});
