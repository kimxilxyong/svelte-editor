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

/** Visual style of text-entry controls (input, textarea, select). */
export type ThemeInputStyle = 'outlined' | 'filled' | 'underlined' | 'soft';

/** Size of text-entry controls: font size and padding. */
export type ThemeInputSize = 'sm' | 'md' | 'lg';

/** Border thickness of text-entry controls (1px, 2px, 4px). Ignored by `underlined`'s sides. */
export type ThemeInputBorder = 'thin' | 'medium' | 'thick';

/** Colour of the focus ring of text-entry controls, or `none` to remove it. */
export type ThemeFocusRing = 'primary' | 'secondary' | 'none';

/** Drop shadow of cards. */
export type ThemeShadow = 'none' | 'sm' | 'md' | 'lg';

/**
 * The persisted site theme.
 *
 * Colours are `#rrggbb`. Every field has a default, and older stored themes that lack the newer
 * fields (`secondary`, `inputStyle`, …) are completed with those defaults by {@link parseSiteTheme}.
 *
 * - `preset`: id of the colour preset, or `custom` when `primary` was edited by hand.
 * - `primary`: base colour (the `500` shade) of the `primary-*` scale.
 * - `secondary`: base colour of the `secondary-*` scale (used by secondary buttons and focus rings).
 * - `background`: page background `#rrggbb`, or `''` (automatic) to follow `dark`. A custom value also
 *   picks a readable default foreground, see {@link siteForeground}.
 * - `foreground`: text colour `#rrggbb`, or `''` (automatic) to derive it from the background.
 * - `radius`: corner radius family of buttons, badges, inputs and cards.
 * - `inputStyle` / `inputSize` / `inputBorder` / `focusRing`: look of text-entry controls.
 * - `shadow`: drop shadow of cards.
 */
export type SiteTheme = {
	preset: string;
	primary: string;
	secondary: string;
	background: string;
	foreground: string;
	radius: ThemeRadius;
	font: ThemeFont;
	dark: boolean;
	inputStyle: ThemeInputStyle;
	inputSize: ThemeInputSize;
	inputBorder: ThemeInputBorder;
	focusRing: ThemeFocusRing;
	shadow: ThemeShadow;
};

/** A selectable `{ value, label }` option for pickers. */
export type ThemeOption<T extends string> = { value: T; label: string };

export const themeInputStyles: readonly ThemeOption<ThemeInputStyle>[] = [
	{ value: 'outlined', label: 'Outlined' },
	{ value: 'filled', label: 'Filled' },
	{ value: 'underlined', label: 'Underlined' },
	{ value: 'soft', label: 'Soft tint' }
];
export const themeInputSizes: readonly ThemeOption<ThemeInputSize>[] = [
	{ value: 'sm', label: 'Small' },
	{ value: 'md', label: 'Medium' },
	{ value: 'lg', label: 'Large' }
];
export const themeInputBorders: readonly ThemeOption<ThemeInputBorder>[] = [
	{ value: 'thin', label: 'Thin' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'thick', label: 'Thick' }
];
export const themeFocusRings: readonly ThemeOption<ThemeFocusRing>[] = [
	{ value: 'primary', label: 'Primary' },
	{ value: 'secondary', label: 'Secondary' },
	{ value: 'none', label: 'None' }
];
export const themeShadows: readonly ThemeOption<ThemeShadow>[] = [
	{ value: 'none', label: 'None' },
	{ value: 'sm', label: 'Subtle' },
	{ value: 'md', label: 'Medium' },
	{ value: 'lg', label: 'Strong' }
];

/**
 * A "look": a bundle of non-colour options applied at once on the `/theme` page. Colours are
 * independent, so every look works with every colour preset.
 */
export type ThemeLook = {
	id: string;
	label: string;
	values: Pick<
		SiteTheme,
		'radius' | 'font' | 'inputStyle' | 'inputSize' | 'inputBorder' | 'focusRing' | 'shadow'
	>;
};

/** Built-in looks, loosely modelled on Flowbite's default / minimal / enterprise / playful themes. */
export const themeLooks: readonly ThemeLook[] = [
	{
		id: 'default',
		label: 'Default',
		values: {
			radius: 'md',
			font: 'sans',
			inputStyle: 'outlined',
			inputSize: 'sm',
			inputBorder: 'thin',
			focusRing: 'primary',
			shadow: 'none'
		}
	},
	{
		id: 'minimal',
		label: 'Minimal',
		values: {
			radius: 'none',
			font: 'sans',
			inputStyle: 'underlined',
			inputSize: 'md',
			inputBorder: 'medium',
			focusRing: 'none',
			shadow: 'none'
		}
	},
	{
		id: 'enterprise',
		label: 'Enterprise',
		values: {
			radius: 'sm',
			font: 'serif',
			inputStyle: 'outlined',
			inputSize: 'md',
			inputBorder: 'medium',
			focusRing: 'primary',
			shadow: 'sm'
		}
	},
	{
		id: 'soft',
		label: 'Soft',
		values: {
			radius: 'lg',
			font: 'sans',
			inputStyle: 'soft',
			inputSize: 'lg',
			inputBorder: 'thin',
			focusRing: 'primary',
			shadow: 'md'
		}
	},
	{
		id: 'playful',
		label: 'Playful',
		values: {
			radius: 'full',
			font: 'sans',
			inputStyle: 'filled',
			inputSize: 'lg',
			inputBorder: 'thick',
			focusRing: 'secondary',
			shadow: 'lg'
		}
	}
];

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
	secondary: '#0ea5e9',
	background: '',
	foreground: '',
	radius: 'md',
	font: 'sans',
	dark: false,
	inputStyle: 'outlined',
	inputSize: 'sm',
	inputBorder: 'thin',
	focusRing: 'primary',
	shadow: 'none'
};

const hexPattern = /^#[0-9a-f]{6}$/i;

/**
 * Reads an optional enumerated field: absent → `fallback`; present but not one of `options` →
 * `undefined` (the caller rejects the whole theme).
 */
function pickOption<T extends string>(
	value: unknown,
	options: readonly ThemeOption<T>[],
	fallback: T
): T | undefined {
	if (value === undefined) return fallback;
	return options.find((option) => option.value === value)?.value;
}

/**
 * Strictly validates an untrusted theme payload.
 *
 * The original five fields (`preset`, `primary`, `radius`, `font`, `dark`) are required. The newer
 * fields are optional so themes saved by older versions keep loading; a missing one takes its
 * default, a present but invalid one rejects the theme. Free-form values (colours) are only ever
 * emitted as CSS variable values, never as class names, so Tailwind's class scanning is unaffected.
 *
 * @param value - Parsed JSON.
 * @returns A normalised {@link SiteTheme} or `null` when any field is invalid.
 */
export function parseSiteTheme(value: unknown): SiteTheme | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const v = value as Record<string, unknown>;
	const d = defaultSiteTheme;
	const secondary = v.secondary === undefined ? d.secondary : v.secondary;
	const background = v.background === undefined ? d.background : v.background;
	const foreground = v.foreground === undefined ? d.foreground : v.foreground;
	const inputStyle = pickOption(v.inputStyle, themeInputStyles, d.inputStyle);
	const inputSize = pickOption(v.inputSize, themeInputSizes, d.inputSize);
	const inputBorder = pickOption(v.inputBorder, themeInputBorders, d.inputBorder);
	const focusRing = pickOption(v.focusRing, themeFocusRings, d.focusRing);
	const shadow = pickOption(v.shadow, themeShadows, d.shadow);
	if (
		typeof v.preset !== 'string' ||
		!/^[a-z0-9-]{1,30}$/.test(v.preset) ||
		typeof v.primary !== 'string' ||
		!hexPattern.test(v.primary) ||
		typeof secondary !== 'string' ||
		!hexPattern.test(secondary) ||
		typeof background !== 'string' ||
		(background !== '' && !hexPattern.test(background)) ||
		typeof foreground !== 'string' ||
		(foreground !== '' && !hexPattern.test(foreground)) ||
		!themeRadii.some((r) => r.value === v.radius) ||
		!themeFonts.some((f) => f.value === v.font) ||
		typeof v.dark !== 'boolean' ||
		!inputStyle ||
		!inputSize ||
		!inputBorder ||
		!focusRing ||
		!shadow
	) {
		return null;
	}
	return {
		preset: v.preset,
		primary: v.primary.toLowerCase(),
		secondary: secondary.toLowerCase(),
		background: background.toLowerCase(),
		foreground: foreground.toLowerCase(),
		radius: v.radius as ThemeRadius,
		font: v.font as ThemeFont,
		dark: v.dark,
		inputStyle,
		inputSize,
		inputBorder,
		focusRing,
		shadow
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
 * Relative luminance (WCAG 2.x) of a `#rrggbb` colour.
 *
 * @param hex - Colour `#rrggbb`.
 */
function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two `#rrggbb` colours (1 … 21). 4.5 is the AA minimum for body text.
 *
 * @example
 * contrastRatio('#000000', '#ffffff'); // 21
 */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** Alias of {@link primaryScale}: the same scale generator is used for the secondary colour. */
export const colorScale = primaryScale;

/**
 * Effective page background of a theme: the custom colour, else white (light) or near-black (dark).
 *
 * @example
 * siteBackground({ ...defaultSiteTheme, dark: true }); // '#111827'
 */
export function siteBackground(theme: Pick<SiteTheme, 'background' | 'dark'>): string {
	if (theme.background) return theme.background;
	return theme.dark ? '#111827' : '#ffffff';
}

/**
 * Effective text colour of a theme: the custom colour if set. Otherwise, with an automatic background it follows `dark`; with a custom
 * background the more readable of the light and dark text colours is chosen.
 *
 * @example
 * siteForeground({ ...defaultSiteTheme, background: '#000000' }); // '#f3f4f6'
 */
export function siteForeground(
	theme: Pick<SiteTheme, 'background' | 'dark'> & { foreground?: string }
): string {
	if (theme.foreground) return theme.foreground;
	const light = '#f3f4f6';
	const dark = '#1f2937';
	if (!theme.background) return theme.dark ? light : dark;
	return contrastRatio(theme.background, dark) >= contrastRatio(theme.background, light)
		? dark
		: light;
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
	for (const [shade, colour] of Object.entries(colorScale(theme.secondary))) {
		vars.push(`--color-secondary-${shade}: ${colour}`);
	}
	// Plain links inside the theme scope follow the primary colour (dark mode needs a lighter shade).
	vars.push(`--site-link: ${scale[theme.dark ? 400 : 600]}`);
	vars.push(`--site-bg: ${siteBackground(theme)}`, `--site-fg: ${siteForeground(theme)}`);
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
 * Class lookup tables for text-entry controls. Every value is a complete literal so Tailwind's
 * source scanner finds it; user input never builds a class name (only picks a table entry).
 */
const inputSizeClasses: Record<ThemeInputSize, string> = {
	sm: 'text-xs px-2 py-1',
	md: 'text-sm px-2.5 py-2.5',
	lg: 'text-base px-3 py-3'
};
const inputBorderClasses: Record<ThemeInputBorder, { all: string; bottom: string }> = {
	thin: { all: 'border', bottom: 'border-0 border-b' },
	medium: { all: 'border-2', bottom: 'border-0 border-b-2' },
	thick: { all: 'border-4', bottom: 'border-0 border-b-4' }
};
const inputFocusClasses: Record<ThemeFocusRing, string> = {
	primary: 'focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
	secondary: 'focus:ring-2 focus:ring-secondary-500 focus:border-secondary-500',
	none: 'focus:ring-0 focus:border-primary-500'
};
const inputStyleClasses: Record<ThemeInputStyle, string> = {
	outlined: 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800',
	filled: 'border-transparent bg-gray-100 dark:bg-gray-700',
	underlined: 'border-gray-300 bg-transparent dark:border-gray-600 dark:bg-transparent',
	soft: 'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-gray-800'
};
const shadowClasses: Record<ThemeShadow, string> = {
	none: 'shadow-none',
	sm: 'shadow-sm',
	md: 'shadow-md',
	lg: 'shadow-lg'
};

/** Vertical-only size classes for controls whose horizontal padding is reserved for an icon. */
const inputSizeYClasses: Record<ThemeInputSize, string> = {
	sm: 'text-xs py-1',
	md: 'text-sm py-2.5',
	lg: 'text-base py-3'
};

/**
 * Composes the classes of one text-entry control (radius first so `underlined` can win).
 *
 * @param padding - `xy` sets full padding; `y` keeps the component's own horizontal padding (search,
 *   phone and file inputs reserve it for an icon); `none` leaves size and padding alone.
 */
function inputClasses(
	theme: SiteTheme,
	control: string,
	padding: 'xy' | 'y' | 'none' = 'xy'
): string {
	const underlined = theme.inputStyle === 'underlined';
	const border = inputBorderClasses[theme.inputBorder];
	return [
		underlined ? 'rounded-none' : control,
		padding === 'xy' ? inputSizeClasses[theme.inputSize] : '',
		padding === 'y' ? inputSizeYClasses[theme.inputSize] : '',
		underlined ? border.bottom : border.all,
		inputStyleClasses[theme.inputStyle],
		inputFocusClasses[theme.focusRing]
	]
		.filter(Boolean)
		.join(' ');
}

/**
 * Component-level overrides for flowbite-svelte's `ThemeProvider` (radius, text-entry look, card
 * shadow). Colours are handled by {@link themeStyle}; flowbite merges these classes with its
 * defaults (tailwind-merge lets the provider win).
 *
 * @param theme - Theme to apply.
 */
export function themeConfig(theme: SiteTheme): ThemeConfig {
	const { control, surface } = radiusClasses[theme.radius];
	return {
		button: { base: control },
		badge: { base: control },
		input: { input: inputClasses(theme, control) },
		select: { select: inputClasses(theme, control) },
		// A pill-shaped multi-line box looks wrong, so textareas use the softer surface radius.
		textarea: { wrapper: inputClasses(theme, surface) },
		search: { input: inputClasses(theme, control, 'y') },
		fileupload: { base: inputClasses(theme, control, 'y') },
		phoneInput: { input: inputClasses(theme, control, 'y') },
		datepicker: { input: inputClasses(theme, control, 'y') },
		timepicker: { select: inputClasses(theme, control, 'y') },
		multiSelect: { base: inputClasses(theme, control, 'none') },
		tags: {
			base: inputClasses(theme, control, 'none'),
			tag: 'dark:bg-gray-600 dark:text-white dark:border-gray-500'
		},
		dropzone: surface,
		floatingLabelInput: { input: control },
		card: { base: `${surface} ${shadowClasses[theme.shadow]}` }
	};
}
