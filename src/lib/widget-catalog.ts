/**
 * @fileoverview Catalog of the compact Flowbite GUI widgets offered in the editor's widget palette.
 *
 * Single source of truth for everything the editor needs to know about a widget kind besides how it
 * renders (that lives in `components/editor/Widget*.svelte`, mapped by `BlockContent.svelte`):
 * palette label/description/icon mark, the palette category used for grouping and filtering, and
 * the content a freshly dropped block starts with.
 *
 * Interacts with:
 * - `editor.ts` – `WidgetKind` is the key type; the catalog must cover every kind (enforced by
 *   the type and by `widget-catalog.spec.ts`).
 * - `routes/editor/+page.svelte` – builds the palette, default block content and block creation.
 */

import type { BuilderBlock, WidgetKind } from './editor.js';

/** Palette groupings for widgets, in display order. */
export const widgetCategories = ['Forms', 'Display', 'Feedback', 'Navigation'] as const;

/** One palette category name. */
export type WidgetCategory = (typeof widgetCategories)[number];

/** Text content, pixel geometry and extras a new block of a widget starts with. */
export type WidgetDefaults = Pick<BuilderBlock, 'title' | 'body' | 'action'> & {
	/** Starting `items` text for list-like widgets (see the widget's `@prop items` docs). */
	items?: string;
	/** Starting level (0–100) for slider- and progress-like widgets. */
	level?: number;
	/** Starting block width in pixels. */
	width: number;
	/** Starting block height in pixels. */
	height: number;
	/** Starting block theme; defaults to `light`. */
	theme?: BuilderBlock['theme'];
};

/** Palette metadata plus block defaults for one widget kind. */
export interface WidgetCatalogEntry {
	/** Display name in the palette. */
	label: string;
	/** One-line description in the palette. */
	detail: string;
	/** Short glyph shown as the palette icon. */
	mark: string;
	/** Palette group the widget is listed under. */
	category: WidgetCategory;
	/** Initial content and pixel size of a newly created block. */
	defaults: WidgetDefaults;
}

/**
 * All compact widgets by block kind. Default sizes are small pixel values (a button is 120×36).
 *
 * @example
 * widgetCatalog['widget-button'].defaults.width; // 120
 */
export const widgetCatalog: Record<WidgetKind, WidgetCatalogEntry> = {
	'widget-button': {
		label: 'Button',
		detail: 'A clear action for visitors',
		mark: '↗',
		category: 'Forms',
		defaults: { title: 'Button', body: '', action: 'Get started', width: 120, height: 36 }
	},
	'widget-text-field': {
		label: 'Text field',
		detail: 'A single-line text input',
		mark: 'T',
		category: 'Forms',
		defaults: { title: 'Email', body: '', action: 'name@example.com', width: 240, height: 64 }
	},
	'widget-textarea': {
		label: 'Textarea',
		detail: 'A multi-line text input',
		mark: '≡',
		category: 'Forms',
		defaults: { title: 'Message', body: '', action: 'Write your message…', width: 240, height: 110 }
	},
	'widget-checkbox': {
		label: 'Checkbox',
		detail: 'Choose an independent option',
		mark: '☑',
		category: 'Forms',
		defaults: { title: 'Keep me updated', body: '', action: '', width: 180, height: 28 }
	},
	'widget-radio': {
		label: 'Radio button',
		detail: 'Choose one option in a group',
		mark: '◉',
		category: 'Forms',
		defaults: { title: 'Standard delivery', body: '', action: '', width: 180, height: 28 }
	},
	'widget-switch': {
		label: 'Toggle',
		detail: 'Turn a setting on or off',
		mark: '⏻',
		category: 'Forms',
		defaults: { title: 'Notifications', body: '', action: '', width: 180, height: 28 }
	},
	'widget-select': {
		label: 'Select menu',
		detail: 'Pick from a list of options',
		mark: '▾',
		category: 'Forms',
		defaults: {
			title: 'Country',
			body: '',
			action: 'Canada',
			items: 'Canada\nUnited States\nUnited Kingdom',
			width: 200,
			height: 64
		}
	},
	'widget-slider': {
		label: 'Range slider',
		detail: 'Choose a value in a range',
		mark: '━',
		category: 'Forms',
		defaults: { title: 'Volume', body: '', action: '', width: 200, height: 48 }
	},
	'widget-badge': {
		label: 'Badge',
		detail: 'A compact status or category',
		mark: '●',
		category: 'Display',
		defaults: { title: 'New', body: '', action: '', theme: 'lavender', width: 60, height: 24 }
	},
	'widget-avatar': {
		label: 'Avatar',
		detail: 'Represent a person or account',
		mark: '◉',
		category: 'Display',
		defaults: { title: 'Alex Morgan', body: 'Designer', action: '', width: 180, height: 48 }
	},
	'widget-card': {
		label: 'Card',
		detail: 'Group related content together',
		mark: '▣',
		category: 'Display',
		defaults: {
			title: 'Card title',
			body: 'A short description.',
			action: 'Learn more',
			width: 240,
			height: 130
		}
	},
	'widget-alert': {
		label: 'Alert',
		detail: 'A short message with context',
		mark: '!',
		category: 'Feedback',
		defaults: {
			title: 'Saved.',
			body: 'Your changes were applied.',
			action: '',
			width: 280,
			height: 44
		}
	},
	'widget-progress': {
		label: 'Progress bar',
		detail: 'Show completion at a glance',
		mark: '▰',
		category: 'Feedback',
		defaults: { title: 'Progress', body: '', action: '', level: 60, width: 200, height: 36 }
	},
	'widget-link': {
		label: 'Link',
		detail: 'Go to a page or website',
		mark: '↪',
		category: 'Navigation',
		defaults: {
			title: 'Read more',
			body: '',
			action: '',
			theme: 'lavender',
			width: 100,
			height: 28
		}
	}
};

/**
 * Case-insensitive search over label, description and category.
 *
 * @param kinds - Candidate kinds.
 * @param query - Free text; blank returns `kinds` unchanged.
 * @returns The kinds whose catalog entry matches every word of the query.
 */
export function filterWidgets(kinds: WidgetKind[], query: string): WidgetKind[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return kinds;
	return kinds.filter((kind) => {
		const entry = widgetCatalog[kind];
		const haystack = `${entry.label} ${entry.detail} ${entry.category}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}
