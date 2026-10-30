/**
 * @fileoverview Site theme model shared by the editor, the `/theme` page and exported projects.
 *
 * A {@link SiteTheme} is a tiny, serialisable description (preset, primary colour, corner radius,
 * font family, dark mode). From it this module derives everything needed to apply the theme:
 * - {@link themeStyle}: inline CSS custom properties (`--color-primary-50…900`, `--site-bg`, `--site-fg`)
 *   that retint every Tailwind `primary-*` utility used by the Flowbite widgets,
 * - {@link themeClasses}: wrapper classes (`dark`, font family),
 * - {@link themeConfig}: the `ThemeConfig` handed to flowbite-svelte's `ThemeProvider` to restyle
 *   corner radii of the widgets.
 *
 * The module is isomorphic and dependency free (type-only import of flowbite-svelte) because the
 * exporter copies this file verbatim to `src/lib/theme.ts` of the target project, where
 * `components/editor/ThemeScope.svelte` imports it as `../../theme.js`.
 *
 * Interacts with:
 * - `components/editor/ThemeScope.svelte` – applies the theme around the canvas / exported pages.
 * - `server/theme.ts` – persists the site-wide theme in the `app_settings` table.
 * - `routes/theme/` – the editing UI.
 * - `server/project.ts` – writes `theme.ts`, `site-theme.ts` and `ThemeScope.svelte` on export.
 */

import type { ThemeConfig } from 'flowbite-svelte';

/** Corner radius families: `none` is square, `full` produces pill-shaped controls. */
export type ThemeRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';

/** Font family choices (mapped to Tailwind's `font-sans|serif|mono`). */
export type ThemeFont = 'sans' | 'serif' | 'mono';

/**
 * The persisted site theme.
 *
 * - `preset`: id of the preset the colour came from, or `custom` when `primary` was edited by hand.
 * - `primary`: base colour (the `500` shade) as `#rrggbb`.
 */
export type SiteTheme = {
	preset: string;
	primary: string;
	radius: ThemeRadius;
	font: ThemeFont;
	dark: boolean;
};

/** A selectable colour preset. */
export type ThemePreset = { id: string; label: string; primary: string };

/** Built-in colour presets, shown as swatches on the `/theme` page. */
export const themePresets: readonly ThemePreset[] = [
	{ id: 'violet', label: 'Violet', primary: '#7766df' },
	{ id: 'ocean', label: 'Ocean', primary: '#2563eb' },
	{ id: 'forest', label: 'Forest', primary: '#16a34a' },
	{ id: 'rose', label: 'Rose', primary: '#e11d48' },
	{ id: 'amber', label: 'Amber', primary: '#d97706' },
	{ id: 'slate', label: 'Slate', primary: '#475569' }
];

/** Radius and font option lists (value + label) for pickers. */
export const themeRadii: readonly { value: ThemeRadius; label: string }[] = [
	{ value: 'none', label: 'Square' },
	{ value: 'sm', label: 'Subtle' },
	{ value: 'md', label: 'Medium' },
	{ value: 'lg', label: 'Rounded' },
	{ value: 'full', label: 'Pill' }
];
export const themeFonts: readonly { value: ThemeFont; label: string }[] = [
	{ value: 'sans', label: 'Sans-serif' },
	{ value: 'serif', label: 'Serif' },
	{ value: 'mono', label: 'Monospace' }
];

/** The theme applied until somebody saves another one. */
export const defaultSiteTheme: Readonly<SiteTheme> = {
	preset: 'violet',
	primary: '#7766df',
	radius: 'md',
	font: 'sans',
	dark: false
};

const hexPattern = /^#[0-9a-f]{6}$/i;

/**
 * Strictly validates an untrusted theme payload.
 *
 * @param value - Parsed JSON.
 * @returns A normalised {@link SiteTheme} or `null` when any field is missing or invalid.
 */
export function parseSiteTheme(value: unknown): SiteTheme | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const v = value as Record<string, unknown>;
	if (
		typeof v.preset !== 'string' ||
		!/^[a-z0-9-]{1,30}$/.test(v.preset) ||
		typeof v.primary !== 'string' ||
		!hexPattern.test(v.primary) ||
		!themeRadii.some((r) => r.value === v.radius) ||
		!themeFonts.some((f) => f.value === v.font) ||
		typeof v.dark !== 'boolean'
	) {
		return null;
	}
	return {
		preset: v.preset,
		primary: v.primary.toLowerCase(),
		radius: v.radius as ThemeRadius,
		font: v.font as ThemeFont,
		dark: v.dark
	};
}

/** Like {@link parseSiteTheme} but falls back to {@link defaultSiteTheme}. */
export function normalizeSiteTheme(value: unknown): SiteTheme {
	return parseSiteTheme(value) ?? { ...defaultSiteTheme };
}

/** Shade stops of the primary scale and how far each is mixed towards white (+) or black (−). */
const scaleStops: [number, number][] = [
	[50, 0.95],
	[100, 0.88],
	[200, 0.74],
	[300, 0.56],
	[400, 0.3],
	[500, 0],
	[600, -0.15],
	[700, -0.3],
	[800, -0.45],
	[900, -0.6]
];

/**
 * Builds a Tailwind-style 50…900 colour scale around a base colour.
 *
 * @param hex - Base colour `#rrggbb` used for shade 500.
 * @returns Map of shade → `#rrggbb`.
 * @example
 * primaryScale('#7766df')[500]; // '#7766df'
 */
export function primaryScale(hex: string): Record<number, string> {
	const base = hexPattern.test(hex) ? hex : defaultSiteTheme.primary;
	const channels = [1, 3, 5].map((i) => Number.parseInt(base.slice(i, i + 2), 16));
	const scale: Record<number, string> = {};
	for (const [shade, mix] of scaleStops) {
		const target = mix >= 0 ? 255 : 0;
		const amount = Math.abs(mix);
		scale[shade] =
			'#' +
			channels
				.map((c) =>
					Math.round(c + (target - c) * amount)
						.toString(16)
						.padStart(2, '0')
				)
				.join('');
	}
	return scale;
}

/**
 * Inline style (CSS custom properties) that applies the colours of a theme to a subtree.
 *
 * @param theme - Theme to apply.
 * @returns Semicolon separated declarations for a `style` attribute.
 */
export function themeStyle(theme: SiteTheme): string {
	const scale = primaryScale(theme.primary);
	const vars = Object.entries(scale).map(
		([shade, colour]) => `--color-primary-${shade}: ${colour}`
	);
	vars.push(
		`--site-bg: ${theme.dark ? '#111827' : '#ffffff'}`,
		`--site-fg: ${theme.dark ? '#f3f4f6' : '#1f2937'}`
	);
	return vars.join('; ');
}

/** Wrapper classes of a theme: the `dark` variant switch and the font family. */
export function themeClasses(theme: SiteTheme): string {
	return `${theme.dark ? 'dark ' : ''}font-${theme.font}`;
}

/** Tailwind radius classes for small controls and for larger surfaces, per radius family. */
const radiusClasses: Record<ThemeRadius, { control: string; surface: string }> = {
	none: { control: 'rounded-none', surface: 'rounded-none' },
	sm: { control: 'rounded-sm', surface: 'rounded-md' },
	md: { control: 'rounded-md', surface: 'rounded-lg' },
	lg: { control: 'rounded-lg', surface: 'rounded-2xl' },
	full: { control: 'rounded-full', surface: 'rounded-3xl' }
};

/**
 * Component-level overrides for flowbite-svelte's `ThemeProvider` (corner radius of the widgets).
 * Colours are handled by {@link themeStyle}; flowbite merges these classes with its defaults.
 *
 * @param theme - Theme to apply.
 */
export function themeConfig(theme: SiteTheme): ThemeConfig {
	const { control, surface } = radiusClasses[theme.radius];
	return {
		button: { base: control },
		badge: { base: control },
		input: { input: control },
		select: { select: control },
		textarea: { wrapper: control },
		card: { base: surface }
	};
}
