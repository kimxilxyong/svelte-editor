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
 * - `lib/components/SiteEditor.svelte` – builds the palette, default block content and block creation.
 */

import type { BuilderBlock, WidgetKind } from './editor.js';

/** Palette groupings for widgets, in display order. */
export const widgetCategories = [
	'Forms',
	'Text',
	'Display',
	'Data',
	'Feedback',
	'Navigation',
	'Overlays'
] as const;

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
	},
	'widget-search': {
		label: 'Search field',
		detail: 'A search box with clear button',
		mark: '⌕',
		category: 'Forms',
		defaults: { title: '', body: '', action: 'Search…', width: 240, height: 64 }
	},
	'widget-file-upload': {
		label: 'File upload',
		detail: 'Let visitors pick a file',
		mark: '⇪',
		category: 'Forms',
		defaults: {
			title: 'Upload file',
			body: 'PNG or JPG, up to 2 MB.',
			action: '',
			width: 240,
			height: 80
		}
	},
	'widget-dropzone': {
		label: 'Dropzone',
		detail: 'Drag and drop files here',
		mark: '⇩',
		category: 'Forms',
		defaults: {
			title: 'Click to upload or drag and drop',
			body: 'SVG, PNG or JPG (max. 800×400px)',
			action: '',
			width: 280,
			height: 120
		}
	},
	'widget-multi-select': {
		label: 'Multi select',
		detail: 'Pick several options',
		mark: '☰',
		category: 'Forms',
		defaults: {
			title: 'Colors',
			body: '',
			action: 'Choose options',
			items: 'Red\nGreen\nBlue',
			width: 240,
			height: 70
		}
	},
	'widget-floating-input': {
		label: 'Floating label input',
		detail: 'Text field with floating label',
		mark: 'Ⓣ',
		category: 'Forms',
		defaults: { title: 'Full name', body: '', action: '', width: 240, height: 56 }
	},
	'widget-datepicker': {
		label: 'Date picker',
		detail: 'Choose a date from a calendar',
		mark: '▦',
		category: 'Forms',
		defaults: { title: 'Date', body: '', action: 'Select date', width: 240, height: 70 }
	},
	'widget-timepicker': {
		label: 'Time picker',
		detail: 'Choose a time of day',
		mark: '◷',
		category: 'Forms',
		defaults: { title: 'Time', body: '', action: '', width: 200, height: 70 }
	},
	'widget-phone-input': {
		label: 'Phone input',
		detail: 'A telephone number field',
		mark: '✆',
		category: 'Forms',
		defaults: { title: 'Phone number', body: '', action: '', width: 240, height: 70 }
	},
	'widget-tags': {
		label: 'Tags input',
		detail: 'Type entries that become chips',
		mark: '#',
		category: 'Forms',
		defaults: {
			title: 'Tags',
			body: '',
			action: 'Add a tag',
			items: 'design\nweb',
			width: 260,
			height: 80
		}
	},
	'widget-button-group': {
		label: 'Button group',
		detail: 'Joined buttons',
		mark: '⫼',
		category: 'Forms',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Profile\nSettings\nMessages',
			width: 260,
			height: 40
		}
	},
	'widget-gradient-button': {
		label: 'Gradient button',
		detail: 'A call to action with gradient',
		mark: '✦',
		category: 'Forms',
		defaults: { title: '', body: '', action: 'Get started', width: 140, height: 40 }
	},
	'widget-rating': {
		label: 'Rating',
		detail: 'Star rating',
		mark: '★',
		category: 'Forms',
		defaults: { title: '4.0 out of 5', body: '', action: '', level: 80, width: 240, height: 48 }
	},
	'widget-clipboard': {
		label: 'Copy to clipboard',
		detail: 'A field with a copy button',
		mark: '⧉',
		category: 'Forms',
		defaults: {
			title: 'Share link',
			body: 'https://example.com/share',
			action: '',
			width: 280,
			height: 70
		}
	},
	'widget-heading': {
		label: 'Heading',
		detail: 'A title in h1–h6',
		mark: 'H',
		category: 'Text',
		defaults: { title: 'Section heading', body: '', action: 'h2', width: 280, height: 44 }
	},
	'widget-paragraph': {
		label: 'Paragraph',
		detail: 'A block of body text',
		mark: '¶',
		category: 'Text',
		defaults: {
			title: '',
			body: 'A short paragraph of text that explains something to your visitors.',
			action: '',
			width: 280,
			height: 70
		}
	},
	'widget-blockquote': {
		label: 'Blockquote',
		detail: 'A highlighted quotation',
		mark: '❝',
		category: 'Text',
		defaults: {
			title: 'Ada Lovelace',
			body: 'Imagination is the discovering faculty.',
			action: '',
			width: 280,
			height: 90
		}
	},
	'widget-divider': {
		label: 'Divider',
		detail: 'A horizontal rule',
		mark: '―',
		category: 'Text',
		defaults: { title: '', body: '', action: '', width: 240, height: 24 }
	},
	'widget-list': {
		label: 'Bullet list',
		detail: 'A list of points',
		mark: '•',
		category: 'Text',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'First point\nSecond point\nThird point',
			width: 220,
			height: 90
		}
	},
	'widget-kbd': {
		label: 'Keyboard keys',
		detail: 'Show a key combination',
		mark: '⌨',
		category: 'Text',
		defaults: { title: '', body: '', action: '', items: 'Ctrl\nK', width: 120, height: 32 }
	},
	'widget-image': {
		label: 'Image',
		detail: 'A picture with caption',
		mark: '▨',
		category: 'Display',
		defaults: { title: 'Image description', body: '', action: '', width: 240, height: 130 }
	},
	'widget-video': {
		label: 'Video',
		detail: 'A video player',
		mark: '▶',
		category: 'Display',
		defaults: { title: 'Video', body: '', action: '', width: 280, height: 140 }
	},
	'widget-spinner': {
		label: 'Spinner',
		detail: 'A loading indicator',
		mark: '◌',
		category: 'Display',
		defaults: { title: 'Loading…', body: '', action: 'default', width: 160, height: 44 }
	},
	'widget-indicator': {
		label: 'Status indicator',
		detail: 'A coloured status dot',
		mark: '●',
		category: 'Display',
		defaults: { title: 'Online', body: '', action: 'green', width: 120, height: 28 }
	},
	'widget-skeleton': {
		label: 'Skeleton',
		detail: 'A loading placeholder',
		mark: '░',
		category: 'Display',
		defaults: { title: '', body: '', action: 'text', width: 240, height: 100 }
	},
	'widget-list-group': {
		label: 'List group',
		detail: 'A list of selectable rows',
		mark: '☷',
		category: 'Display',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Profile\nSettings\nMessages',
			width: 220,
			height: 110
		}
	},
	'widget-accordion': {
		label: 'Accordion',
		detail: 'Collapsible sections',
		mark: '☰',
		category: 'Data',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'What is this? | A visual page builder.\nCan I export it? | Yes, as native Svelte.',
			width: 280,
			height: 130
		}
	},
	'widget-tabs': {
		label: 'Tabs',
		detail: 'Switch between panels',
		mark: '▭',
		category: 'Data',
		defaults: {
			title: '',
			body: '',
			action: '',
			items:
				'Profile | Your profile details.\nSettings | Your preferences.\nContacts | Your contacts.',
			width: 280,
			height: 120
		}
	},
	'widget-table': {
		label: 'Table',
		detail: 'Rows and columns of data',
		mark: '▦',
		category: 'Data',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Product | Color | Price\nLaptop | Silver | $2999\nPhone | Black | $799',
			width: 300,
			height: 130
		}
	},
	'widget-timeline': {
		label: 'Timeline',
		detail: 'Events in time order',
		mark: '⋮',
		category: 'Data',
		defaults: {
			title: '',
			body: '',
			action: '',
			items:
				'January 2025 | Launch | The first version went live.\nMarch 2025 | Growth | We reached 1,000 users.',
			width: 280,
			height: 140
		}
	},
	'widget-stepper': {
		label: 'Step indicator',
		detail: 'Progress through steps',
		mark: '①',
		category: 'Data',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Account\nProfile\nDone',
			level: 50,
			width: 280,
			height: 48
		}
	},
	'widget-radial-progress': {
		label: 'Radial progress',
		detail: 'Circular completion',
		mark: '◔',
		category: 'Data',
		defaults: { title: 'Completed', body: '', action: '', level: 60, width: 180, height: 72 }
	},
	'widget-pagination': {
		label: 'Pagination',
		detail: 'Switch between pages of results',
		mark: '⇆',
		category: 'Data',
		defaults: { title: '', body: '', action: '', items: '1\n2\n3\n4\n5', width: 280, height: 44 }
	},
	'widget-toast': {
		label: 'Toast',
		detail: 'A small notification',
		mark: '✉',
		category: 'Feedback',
		defaults: {
			title: 'Message sent',
			body: 'We will get back to you soon.',
			action: '',
			width: 280,
			height: 70
		}
	},
	'widget-banner': {
		label: 'Banner',
		detail: 'A dismissible announcement',
		mark: '▬',
		category: 'Feedback',
		defaults: {
			title: 'New:',
			body: 'Dark mode is now available.',
			action: '',
			width: 300,
			height: 56
		}
	},
	'widget-tooltip': {
		label: 'Tooltip',
		detail: 'A hint on hover',
		mark: 'ⓘ',
		category: 'Feedback',
		defaults: { title: 'Helpful hint', body: '', action: 'Hover me', width: 120, height: 40 }
	},
	'widget-popover': {
		label: 'Popover',
		detail: 'A card that opens on click',
		mark: '◗',
		category: 'Feedback',
		defaults: {
			title: 'More details',
			body: 'A short explanation shown in a popover.',
			action: 'More info',
			width: 120,
			height: 40
		}
	},
	'widget-breadcrumb': {
		label: 'Breadcrumb',
		detail: 'Show where the visitor is',
		mark: '›',
		category: 'Navigation',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Home | /\nProjects | /projects\nFlowbite',
			width: 280,
			height: 32
		}
	},
	'widget-navbar': {
		label: 'Navbar',
		detail: 'A top navigation bar',
		mark: '☰',
		category: 'Navigation',
		defaults: {
			title: 'My Site',
			body: '',
			action: '',
			items: 'Home | /\nAbout | /about\nContact | /contact',
			width: 300,
			height: 70
		}
	},
	'widget-footer': {
		label: 'Footer',
		detail: 'Copyright and links',
		mark: '▁',
		category: 'Navigation',
		defaults: {
			title: 'My Site',
			body: '',
			action: '',
			items: 'About | /about\nPrivacy | /privacy\nContact | /contact',
			width: 300,
			height: 50
		}
	},
	'widget-sidebar': {
		label: 'Sidebar',
		detail: 'A vertical navigation list',
		mark: '▌',
		category: 'Navigation',
		defaults: {
			title: '',
			body: '',
			action: '',
			items: 'Dashboard | /\nInbox | /inbox\nSettings | /settings',
			width: 200,
			height: 130
		}
	},
	'widget-dropdown': {
		label: 'Dropdown',
		detail: 'A button with a menu',
		mark: '▾',
		category: 'Navigation',
		defaults: {
			title: '',
			body: '',
			action: 'Menu',
			items: 'Dashboard\nSettings\nSign out',
			width: 120,
			height: 40
		}
	},
	'widget-modal': {
		label: 'Modal',
		detail: 'A dialog over the page',
		mark: '▣',
		category: 'Overlays',
		defaults: {
			title: 'Terms of service',
			body: 'Please read the terms before you continue.',
			action: 'Open modal',
			width: 130,
			height: 40
		}
	},
	'widget-drawer': {
		label: 'Drawer',
		detail: 'A panel that slides in',
		mark: '◧',
		category: 'Overlays',
		defaults: {
			title: 'Drawer',
			body: 'Content of the drawer.',
			action: 'Open drawer',
			width: 130,
			height: 40
		}
	},
	'widget-dialog': {
		label: 'Dialog',
		detail: 'A native confirmation dialog',
		mark: '◨',
		category: 'Overlays',
		defaults: {
			title: 'Are you sure?',
			body: 'This action can not be undone.',
			action: 'Open dialog',
			width: 130,
			height: 40
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
