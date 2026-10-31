/**
 * @fileoverview Capability map of the block inspector: which editable fields are meaningful for
 * each block kind.
 *
 * The inspector (`components/BlockInspector.svelte`) renders controls strictly from
 * {@link inspectorFields}, so a control only exists when the widget actually renders (or exports)
 * that field. Geometry, layer order and theme are universal and deliberately not listed here.
 *
 * Contract:
 * - Input: a {@link BlockKind} (built-in widget, `composite:<Name>` or `custom:<Name>`).
 * - Output: an {@link InspectorFields} record; absent keys mean "do not show a control".
 *
 * Keep it in sync with `components/BlockContent.svelte` (what is rendered) and the `kindProps`
 * whitelist in `svelte-pages.ts` (what is exported). `inspector-fields.spec.ts` guards the pairing
 * for the link fields.
 */

import type { BlockKind, WidgetKind } from './editor.js';

/** Text fields of a block: the human label of the control, or absent when it is not rendered. */
export interface InspectorFields {
	/** Label of the `title` text input. */
	title?: string;
	/** Label of the `body` textarea. */
	body?: string;
	/** Label of the `action` text input (button label or input placeholder). */
	action?: string;
	/** Shows the "Selected option" picker (select widget). */
	selectedOption?: true;
	/** Shows the "Initially selected" checkbox. */
	checked?: true;
	/** Shows the one-entry-per-line editor and its format hint. */
	items?: string;
	/** Shows the percentage slider (slider / progress widgets). */
	level?: true;
	/**
	 * Shows the Link Navigation group (`href` + `newTab`). For widgets whose link is optional
	 * (button, card) an empty address means "no link".
	 */
	link?: { optional: boolean };
	/** Shows one editor per entry of `customProps` (imported components only). */
	customProps?: true;
}

const labelled = (title: string, body = 'Helper text'): InspectorFields => ({ title, body });

/** Fields per built-in widget. Mirrors what each `Widget*.svelte` renders. */
const widgetFields: Record<WidgetKind, InspectorFields> = {
	// The button renders only `action` as its label and `body` as its tooltip; `title` is unused.
	'widget-button': { action: 'Button label', body: 'Tooltip', link: { optional: true } },
	'widget-text-field': { ...labelled('Label'), action: 'Placeholder' },
	'widget-textarea': { ...labelled('Label'), action: 'Placeholder' },
	'widget-checkbox': { ...labelled('Label'), checked: true },
	'widget-radio': { ...labelled('Label'), checked: true },
	'widget-switch': { ...labelled('Label'), checked: true },
	'widget-select': {
		...labelled('Label'),
		selectedOption: true,
		items: 'One option per line.'
	},
	'widget-slider': { ...labelled('Label'), level: true },
	'widget-badge': { title: 'Badge text', body: 'Tooltip' },
	'widget-alert': { title: 'Heading', body: 'Message' },
	'widget-progress': { ...labelled('Label'), level: true },
	'widget-avatar': { title: 'Name', body: 'Subtitle' },
	'widget-card': {
		title: 'Heading',
		body: 'Description',
		action: 'Button label',
		link: { optional: true }
	},
	'widget-link': { title: 'Link text', body: 'Tooltip', link: { optional: false } }
};

/**
 * Returns the inspector fields that are meaningful for a block kind.
 *
 * Composite instances render their own child blocks, so they expose no content fields at all.
 * Imported components expose a heading, description and their discovered props.
 *
 * @param kind - The selected block's kind.
 * @example
 * inspectorFields('widget-button').title; // undefined – the button never renders a title
 */
export function inspectorFields(kind: BlockKind): InspectorFields {
	if (kind.startsWith('composite:')) return {};
	if (kind.startsWith('custom:')) {
		return { title: 'Heading', body: 'Description', customProps: true };
	}
	return widgetFields[kind as WidgetKind] ?? {};
}
