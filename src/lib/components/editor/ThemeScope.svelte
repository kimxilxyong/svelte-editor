<script lang="ts">
	/**
	 * @component ThemeScope
	 * Applies a {@link SiteTheme} to everything inside it: Flowbite's `ThemeProvider` for component
	 * overrides (corner radius), inline CSS variables that retint the `primary-*` palette, the `dark`
	 * class and the font family. The wrapper uses `display: contents`, so it never affects layout.
	 *
	 * It is part of the files copied into exported projects (as
	 * `src/lib/components/editor/ThemeScope.svelte`), next to `src/lib/theme.ts`.
	 *
	 * @prop {SiteTheme} [theme] - Theme to apply. Defaults to {@link defaultSiteTheme}.
	 * @prop {Snippet} children - Content to theme.
	 *
	 * @example
	 * <ThemeScope theme={siteTheme}><PageView … /></ThemeScope>
	 */
	import type { Snippet } from 'svelte';
	import { ThemeProvider } from 'flowbite-svelte';
	import {
		defaultSiteTheme,
		themeClasses,
		themeConfig,
		themeStyle,
		type SiteTheme
	} from '../../theme.js';

	let { theme = defaultSiteTheme, children }: { theme?: SiteTheme; children: Snippet } = $props();
</script>

<div class="theme-scope {themeClasses(theme)}" style={themeStyle(theme)}>
	<ThemeProvider theme={themeConfig(theme)}>
		{@render children()}
	</ThemeProvider>
</div>

<style>
	.theme-scope {
		display: contents;
	}
</style>
