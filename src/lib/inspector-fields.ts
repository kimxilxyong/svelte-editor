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
	/**
	 * Shows the managed Image Picker for widgets that can render an icon, avatar, thumbnail or
	 * full image (`image` field, plus `action` sync on `widget-image`).
	 */
	image?: { label: string };
	/** Shows one editor per entry of `customProps` (imported components only). */
	customProps?: true;
}

const labelled = (title: string, body = 'Helper text'): InspectorFields => ({ title, body });

/** Fields per built-in widget. Mirrors what each `Widget*.svelte` renders. */
const widgetFields: Record<WidgetKind, InspectorFields> = {
	// The button renders only `action` as its label and `body` as its tooltip; `title` is unused.
	'widget-button': {
		action: 'Button label',
		body: 'Tooltip',
		link: { optional: true },
		image: { label: 'Button icon / image' }
	},
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
	'widget-badge': { title: 'Badge text', body: 'Tooltip', image: { label: 'Badge icon' } },
	'widget-alert': { title: 'Heading', body: 'Message', image: { label: 'Alert icon' } },
	'widget-progress': { ...labelled('Label'), level: true },
	'widget-avatar': { title: 'Name', body: 'Subtitle', image: { label: 'Avatar image' } },
	'widget-card': {
		title: 'Heading',
		body: 'Description',
		action: 'Button label',
		link: { optional: true },
		image: { label: 'Card image' }
	},
	'widget-link': {
		title: 'Link text',
		body: 'Tooltip',
		link: { optional: false },
		image: { label: 'Link icon / image' }
	},
	'widget-search': { body: 'Helper text', action: 'Placeholder' },
	'widget-file-upload': { title: 'Label', body: 'Helper text' },
	'widget-dropzone': { title: 'Instruction', body: 'Hint' },
	'widget-multi-select': {
		title: 'Label',
		body: 'Helper text',
		action: 'Placeholder',
		items: 'One option per line.'
	},
	'widget-floating-input': { title: 'Floating label', body: 'Helper text' },
	'widget-datepicker': { title: 'Label', body: 'Helper text', action: 'Placeholder' },
	'widget-timepicker': { title: 'Label', body: 'Helper text' },
	'widget-phone-input': { title: 'Label', body: 'Helper text' },
	'widget-tags': { title: 'Label', action: 'Placeholder', items: 'Initial tags, one per line.' },
	'widget-button-group': { body: 'Tooltip', items: 'One button label per line.' },
	'widget-gradient-button': {
		action: 'Button label',
		body: 'Tooltip',
		link: { optional: true },
		image: { label: 'Button icon / image' }
	},
	'widget-rating': { title: 'Caption', body: 'Helper text', level: true },
	'widget-clipboard': { title: 'Label', body: 'Text to copy' },
	'widget-heading': { title: 'Heading text', action: 'Tag (h1–h6)' },
	'widget-paragraph': { body: 'Text' },
	'widget-blockquote': { body: 'Quote', title: 'Attribution' },
	'widget-divider': { title: 'Centered text (optional)' },
	'widget-list': { items: 'One entry per line.' },
	'widget-kbd': { items: 'One key per line.' },
	'widget-image': {
		title: 'Alt text',
		body: 'Caption',
		action: 'Image URL',
		image: { label: 'Pick image' }
	},
	'widget-video': { title: 'Accessible title', action: 'Video URL' },
	'widget-spinner': { title: 'Caption', action: 'Style: default, dots, bars, pulse, orbit' },
	'widget-indicator': {
		title: 'Label',
		action: 'Color: green, red, yellow, blue, gray, purple, indigo'
	},
	'widget-skeleton': { action: 'Variant: text, image, card, list, video, testimonial, widget' },
	'widget-list-group': { items: 'One row per line.' },
	'widget-accordion': { items: 'One section per line: Heading | Content' },
	'widget-tabs': { items: 'One tab per line: Title | Panel text' },
	'widget-table': {
		items: 'One row per line, cells separated by |. The first line is the header.'
	},
	'widget-timeline': { items: 'One event per line: Date | Title | Text' },
	'widget-stepper': { items: 'One step name per line.', level: true },
	'widget-radial-progress': { title: 'Caption', level: true },
	'widget-pagination': { items: 'One page label per line.' },
	'widget-toast': { title: 'Heading', body: 'Message', image: { label: 'Toast icon' } },
	'widget-banner': { title: 'Lead-in', body: 'Announcement', image: { label: 'Banner icon' } },
	'widget-tooltip': { title: 'Tooltip text', action: 'Button label' },
	'widget-popover': { title: 'Popover heading', body: 'Popover text', action: 'Button label' },
	'widget-breadcrumb': { items: 'One crumb per line: Label | /link (link optional)' },
	'widget-navbar': {
		title: 'Brand name',
		items: 'One link per line: Label | /link',
		image: { label: 'Brand logo / icon' }
	},
	'widget-footer': { title: 'Owner', items: 'One link per line: Label | /link' },
	'widget-sidebar': { items: 'One entry per line: Label | /link' },
	'widget-dropdown': {
		action: 'Button label',
		items: 'One entry per line: Label | /link (link optional)'
	},
	'widget-modal': { title: 'Modal heading', body: 'Modal text', action: 'Button label' },
	'widget-drawer': { title: 'Drawer heading', body: 'Drawer text', action: 'Button label' },
	'widget-dialog': { title: 'Dialog heading', body: 'Dialog text', action: 'Button label' }
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
