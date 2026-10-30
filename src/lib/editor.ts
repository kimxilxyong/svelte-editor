/**
 * @fileoverview Core data models, schema definitions, validation logic, and component
 * resolution for the visual SvelteKit Page Editor.
 *
 * This module defines the domain entities used across the application:
 * - Block kinds (atomic widgets, composite components and imported custom components).
 * - Composite components: reusable groups of widgets (and other composites) that are edited on a
 *   visual canvas exactly like pages and exported as native `.svelte` components.
 * - Layout and positioning models (absolute pixel geometry).
 * - Site structure (`EditorSite` -> `EditorPage` -> `BuilderBlock`).
 * - Runtime validation and sanitization for block attributes, routes, and link targets.
 */

/**
 * Atomic GUI widget component types.
 */
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

/**
 * Dynamic custom component kind prefix, e.g., 'custom:NewsletterSignup'. These are native
 * `.svelte` components imported from a target project, not built on the canvas.
 */
export type CustomKind = `custom:${string}`;

/**
 * Composite component kind, e.g. 'composite:Hero': an instance of an {@link EditorComposite}
 * (one or more widgets edited on a visual canvas) with the same name.
 */
export type CompositeKind = `composite:${string}`;

/**
 * Union of all valid component kinds accepted by the editor canvas and generator.
 */
export type BlockKind = WidgetKind | CompositeKind | CustomKind;

/** PascalCase name pattern of a composite component (also its exported file name). */
export const compositeNamePattern = /^[A-Z][A-Za-z0-9]{0,39}$/;

/**
 * Validates whether a string is a correctly formatted composite kind identifier.
 *
 * @param kind - The block kind string to validate.
 * @returns `true` for `composite:<PascalCaseName>`.
 */
export function isValidCompositeKind(kind: string): boolean {
	return kind.startsWith('composite:') && compositeNamePattern.test(kind.slice(10));
}

/**
 * Builds the block kind that instantiates a composite.
 *
 * @param name - The composite's PascalCase name.
 * @returns The `composite:<name>` kind.
 */
export function compositeKind(name: string): CompositeKind {
	return `composite:${name}`;
}

/**
 * Validates whether a given string is a correctly formatted custom component kind identifier.
 *
 * @param kind - The component kind string to validate.
 * @returns `true` if the identifier matches the `custom:<PascalOrCamelName>` pattern.
 */
export function isValidCustomKind(kind: string): boolean {
	return /^custom:[A-Za-z0-9_-]{1,60}$/.test(kind);
}

/**
 * Visual styling theme of a block.
 */
export type Theme = 'light' | 'lavender' | 'dark';

/**
 * Represents a single visual component or widget placed onto an editor page.
 *
 * All geometry is in absolute CSS pixels relative to the canvas top-left corner:
 * - `x`: Horizontal offset (0 to {@link blockLimits}.maxX).
 * - `y`: Vertical offset (0 to 5000).
 * - `width`: Horizontal span ({@link blockLimits}.minWidth to maxWidth).
 * - `height`: Vertical span ({@link blockLimits}.minHeight to maxHeight).
 */
export type BuilderBlock = {
	/** Unique identifier for the block instance (UUID). */
	id: string;
	/** Component kind identifier (widget, composite or custom). */
	kind: BlockKind;
	/** Primary text label or heading. */
	title: string;
	/** Secondary descriptive text or body content. */
	body: string;
	/** Action button label or kicker caption. */
	action: string;
	/** Visual color theme of the block. */
	theme: Theme;
	/** Whether the block is positioned with coordinates (always true in current version). */
	positioned: boolean;
	/** Horizontal coordinate in pixels from the canvas left edge. */
	x: number;
	/** Vertical coordinate in pixels from canvas top. */
	y: number;
	/** Width in pixels. */
	width: number;
	/** Height in pixels. */
	height: number;
	/** Input value for text fields, textareas, and select menus. */
	value: string;
	/** Checked state for checkboxes, radio buttons, and switches. */
	checked: boolean;
	/** Level percentage (0-100) for sliders and progress bars. */
	level: number;
	/** Target URL or internal page route for link widgets. */
	href: string;
	/** Whether external links should open in a new browser tab. */
	newTab: boolean;
	/**
	 * Newline-separated entries for list-like Flowbite widgets (accordion sections, tabs, table rows,
	 * breadcrumb crumbs, …). Each widget documents its own line format; `undefined` means "use the
	 * widget's built-in sample entries".
	 */
	items?: string;
	/** Dynamic properties for custom Svelte components imported from target projects. */
	customProps?: Record<string, string | number | boolean>;
};

/**
 * Represents a single route page within a multi-page site.
 */
export type EditorPage = {
	/** Unique identifier for the page (UUID or 'home'). */
	id: string;
	/** Human-readable display name for the page. */
	name: string;
	/** URL slug used in routes (e.g., 'about', 'contact', 'home'). */
	slug: string;
	/** Canvas viewport width in pixels (e.g. 390 for mobile, 1200 for desktop). */
	width: number;
	/** Minimum canvas viewport height in pixels. */
	height: number;
	/** List of blocks positioned on this page. */
	blocks: BuilderBlock[];
};

/**
 * A composite component: a reusable group of one or more widgets (or other composites) laid out
 * on its own canvas. Geometry follows the same pixel conventions as {@link EditorPage}; when an
 * instance is placed on a page the child blocks scale proportionally to the instance size.
 */
export type EditorComposite = {
	/** Unique identifier (UUID or seed id). */
	id: string;
	/** PascalCase name; also the `.svelte` file name and the `composite:<name>` kind. */
	name: string;
	/** Canvas width in pixels (the natural size of a new instance). */
	width: number;
	/** Canvas height in pixels. */
	height: number;
	/** Blocks positioned on the composite canvas. */
	blocks: BuilderBlock[];
};

/**
 * Root site model holding all pages and composite components of the user's project.
 */
export type EditorSite = {
	/** Ordered list of pages in the site. */
	pages: EditorPage[];
	/** Composite components that page blocks of kind `composite:<name>` refer to. */
	composites: EditorComposite[];
};

/** List of recognized built-in widget kinds. */
const blockKinds: BlockKind[] = [
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

/** Permitted theme names. */
const themes: Theme[] = ['light', 'lavender', 'dark'];

/**
 * Allowed boundaries for canvas viewport dimensions.
 */
export const canvasLimits = {
	minWidth: 320,
	maxWidth: 3840,
	minHeight: 300,
	maxHeight: 5000
};

/**
 * Allowed boundaries for a Composite Component's design size. Smaller than page canvases because
 * a composite is a building block (e.g. a 200×60 call-to-action strip).
 */
export const compositeLimits = {
	minWidth: 40,
	maxWidth: 3840,
	minHeight: 40,
	maxHeight: 5000
};

/** Pixel bounds for a block's geometry (all values are CSS pixels). */
export const blockLimits = {
	minWidth: 16,
	maxWidth: 3840,
	minHeight: 16,
	maxHeight: 1600,
	maxX: 3840,
	maxY: 5000
};

/** A named, commonly used canvas resolution (CSS pixels). */
export interface CanvasPreset {
	/** Human readable name shown in the size picker. */
	label: string;
	width: number;
	height: number;
	/** Device family used to group the picker options. */
	group: 'Desktop' | 'Tablet' | 'Mobile';
}

/**
 * Common screen resolutions offered by the canvas size picker. Every entry must stay within
 * {@link canvasLimits}; the order is the display order inside each group.
 */
export const canvasPresets: CanvasPreset[] = [
	{ group: 'Desktop', label: 'Full HD', width: 1920, height: 1080 },
	{ group: 'Desktop', label: '4K UHD', width: 3840, height: 2160 },
	{ group: 'Desktop', label: 'QHD (2K)', width: 2560, height: 1440 },
	{ group: 'Desktop', label: 'WXGA+ laptop', width: 1440, height: 900 },
	{ group: 'Desktop', label: 'HD laptop', width: 1366, height: 768 },
	{ group: 'Desktop', label: 'Small desktop', width: 1280, height: 720 },
	{ group: 'Desktop', label: 'XGA', width: 1024, height: 768 },
	{ group: 'Tablet', label: 'iPad Pro 12.9" (portrait)', width: 1024, height: 1366 },
	{ group: 'Tablet', label: 'iPad (portrait)', width: 768, height: 1024 },
	{ group: 'Tablet', label: 'Android tablet (portrait)', width: 800, height: 1280 },
	{ group: 'Mobile', label: 'iPhone Pro Max', width: 430, height: 932 },
	{ group: 'Mobile', label: 'iPhone 14/15', width: 390, height: 844 },
	{ group: 'Mobile', label: 'Android (Pixel)', width: 412, height: 915 },
	{ group: 'Mobile', label: 'iPhone SE', width: 375, height: 667 }
];

/** Canvas size used for newly created pages: Full HD. */
export const defaultCanvasSize = { width: 1920, height: 1080 } as const;

/**
 * Finds the preset matching an exact size.
 *
 * @param width - Canvas width in pixels.
 * @param height - Canvas (minimum) height in pixels.
 * @returns The matching preset, or `undefined` for a custom size.
 */
export function findCanvasPreset(width: number, height: number): CanvasPreset | undefined {
	return canvasPresets.find((preset) => preset.width === width && preset.height === height);
}

/** Regular expression validating page route slugs. */
const slugPattern = /^[a-z0-9-]{1,40}$/;

/**
 * Validates link href targets for safety against script injection and invalid formats.
 *
 * Accepts:
 * - Empty string
 * - Relative internal paths matching `^/[a-z0-9\-_/#?=&.]*$`
 * - Absolute HTTP/HTTPS URLs matching `^https?://[^\s]+$`
 *
 * Rejects javascript: URLs, data: URIs, or overly long inputs (>200 chars).
 *
 * @param href - The link target string to validate.
 * @returns `true` if the href is safe and valid.
 */
export function isValidLinkHref(href: string): boolean {
	return (
		href === '' ||
		(href.length <= 200 &&
			(/^\/[a-z0-9\-_/#?=&.]*$/i.test(href) || /^https?:\/\/[^\s]+$/i.test(href)))
	);
}

/**
 * Parses, sanitizes, and bounds-checks an untrusted block collection payload.
 *
 * Automatically converts legacy flow blocks into positioned blocks and enforces
 * pixel geometry limits ({@link blockLimits}).
 *
 * @param value - Untrusted JSON or parsed object array.
 * @returns Validated BuilderBlock array, or `null` if the payload is malformed.
 */
export function parseBuilderBlocks(value: unknown): BuilderBlock[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;

	const ids = new Set<string>();
	const blocks: BuilderBlock[] = [];
	let nextFlowPosition = 40;

	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

		const block = item as Record<string, unknown>;
		const positioned = block.positioned ?? true;
		const x = block.x ?? 24;
		const y = block.y ?? 40;
		const width = block.width ?? 240;
		const height = block.height ?? 40;
		const value = block.value ?? '';
		const checked = block.checked ?? false;
		const level = block.level ?? 60;
		const href = block.href ?? '';
		const newTab = block.newTab ?? false;
		const items = block.items ?? '';

		if (
			typeof block.id !== 'string' ||
			block.id.length === 0 ||
			block.id.length > 100 ||
			ids.has(block.id) ||
			typeof block.kind !== 'string' ||
			(!blockKinds.includes(block.kind as BlockKind) &&
				!isValidCustomKind(block.kind) &&
				!isValidCompositeKind(block.kind)) ||
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
			x > blockLimits.maxX ||
			typeof y !== 'number' ||
			!Number.isFinite(y) ||
			y < 0 ||
			y > blockLimits.maxY ||
			typeof width !== 'number' ||
			!Number.isFinite(width) ||
			width < blockLimits.minWidth ||
			width > blockLimits.maxWidth ||
			typeof height !== 'number' ||
			!Number.isFinite(height) ||
			height < blockLimits.minHeight ||
			height > blockLimits.maxHeight ||
			typeof value !== 'string' ||
			value.length > 100 ||
			typeof checked !== 'boolean' ||
			typeof level !== 'number' ||
			!Number.isFinite(level) ||
			level < 0 ||
			level > 100 ||
			typeof href !== 'string' ||
			!isValidLinkHref(href) ||
			typeof newTab !== 'boolean' ||
			typeof items !== 'string' ||
			items.length > 600
		) {
			return null;
		}

		const positionedY = positioned ? y : nextFlowPosition;
		ids.add(block.id);
		if (!positioned) nextFlowPosition = Math.min(blockLimits.maxY, positionedY + height + 16);

		let customProps: Record<string, string | number | boolean> | undefined;
		if (
			block.customProps &&
			typeof block.customProps === 'object' &&
			!Array.isArray(block.customProps)
		) {
			customProps = {};
			for (const [k, v] of Object.entries(block.customProps as Record<string, unknown>)) {
				if (typeof k === 'string' && k.length <= 60) {
					if (typeof v === 'string' && v.length <= 500) customProps[k] = v;
					else if (typeof v === 'number' && Number.isFinite(v)) customProps[k] = v;
					else if (typeof v === 'boolean') customProps[k] = v;
				}
			}
		}

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
			newTab,
			...(items ? { items } : {}),
			...(customProps ? { customProps } : {})
		});
	}

	return blocks;
}

/**
 * Parses and validates an entire multi-page EditorSite structure.
 *
 * Ensures:
 * - 1 to 20 pages exist.
 * - 0 to 50 composites (optional `composites` array) with unique PascalCase names that do not
 *   shadow a widget component, and no composite refers to itself directly or indirectly.
 * - Slugs are non-empty, unique, and follow the kebab-case pattern `^[a-z0-9-]{1,40}$`.
 * - Viewport dimensions respect canvas limits.
 * - All nested blocks are valid.
 *
 * @param value - Untrusted JSON object representing a site payload.
 * @returns Validated EditorSite, or `null` if invalid.
 */
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

	const composites = parseComposites((value as Record<string, unknown>).composites);
	if (!composites) return null;

	return { pages, composites };
}

/** Maximum number of composites per site. */
const maxComposites = 50;

/**
 * Parses and validates the `composites` array of a site payload.
 *
 * @param value - Untrusted JSON; `undefined` is treated as "no composites".
 * @returns Validated composites, or `null` when malformed, duplicated or cyclic.
 */
export function parseComposites(value: unknown): EditorComposite[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > maxComposites) return null;

	const ids = new Set<string>();
	const names = new Set<string>();
	const reserved = new Set<string>([...Object.values(componentNames), 'ThemeScope']);
	const composites: EditorComposite[] = [];

	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
		const composite = item as Record<string, unknown>;
		const blocks = parseBuilderBlocks(composite.blocks);
		if (
			!blocks ||
			typeof composite.id !== 'string' ||
			composite.id.length === 0 ||
			composite.id.length > 100 ||
			ids.has(composite.id) ||
			typeof composite.name !== 'string' ||
			!compositeNamePattern.test(composite.name) ||
			names.has(composite.name) ||
			reserved.has(composite.name) ||
			typeof composite.width !== 'number' ||
			!Number.isFinite(composite.width) ||
			composite.width < compositeLimits.minWidth ||
			composite.width > compositeLimits.maxWidth ||
			typeof composite.height !== 'number' ||
			!Number.isFinite(composite.height) ||
			composite.height < compositeLimits.minHeight ||
			composite.height > compositeLimits.maxHeight
		) {
			return null;
		}
		ids.add(composite.id);
		names.add(composite.name);
		composites.push({
			id: composite.id,
			name: composite.name,
			width: composite.width,
			height: composite.height,
			blocks
		});
	}

	return findCompositeCycle(composites) ? null : composites;
}

/**
 * Detects composites that (transitively) contain an instance of themselves, which would make
 * rendering and export recurse forever.
 *
 * @param composites - All composites of a site.
 * @returns The name of one composite on a cycle, or `undefined` when the graph is acyclic.
 * @example
 * findCompositeCycle([{ name: 'A', blocks: [{ kind: 'composite:A' }] }]); // 'A'
 */
export function findCompositeCycle(
	composites: Pick<EditorComposite, 'name' | 'blocks'>[]
): string | undefined {
	const edges = new Map(
		composites.map((composite) => [
			composite.name,
			composite.blocks.filter((b) => b.kind.startsWith('composite:')).map((b) => b.kind.slice(10))
		])
	);
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (name: string): string | undefined => {
		if (state.get(name) === 'done') return undefined;
		if (state.get(name) === 'visiting') return name;
		state.set(name, 'visiting');
		for (const next of edges.get(name) ?? []) {
			if (edges.has(next)) {
				const found = visit(next);
				if (found) return found;
			}
		}
		state.set(name, 'done');
		return undefined;
	};
	for (const name of edges.keys()) {
		const found = visit(name);
		if (found) return found;
	}
	return undefined;
}

/**
 * Maps a block kind identifier to its corresponding native Svelte component PascalCase name.
 *
 * @param kind - Block kind identifier (e.g. 'widget-button', 'composite:Hero', 'custom:NewsletterSignup').
 * @returns The component name without file extension (e.g. 'WidgetButton', 'Hero', 'NewsletterSignup').
 */
export function getComponentName(kind: BlockKind): string {
	if (kind.startsWith('custom:')) return kind.slice(7);
	if (kind.startsWith('composite:')) return kind.slice(10);
	return (componentNames as Record<string, string>)[kind] || kind;
}

/**
 * Registry of PascalCase component file names for built-in widgets.
 */
export const componentNames: Record<WidgetKind, string> = {
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
