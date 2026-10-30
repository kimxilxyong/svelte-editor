<script lang="ts">
	/**
	 * @fileoverview Root layout. It mounts the single app-wide navigation bar (`AppNav`, which
	 * includes the user menu) above every route and owns the two navigation hooks, because the
	 * layout is never re-created between routes:
	 * - `afterNavigate` feeds every completed navigation into the trail (see `navigation.svelte.ts`).
	 * - `beforeNavigate` asks for confirmation when the active route reports unsaved changes
	 *   and the navigation would leave that route (page switches inside the editor are fine).
	 */
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import DemoLinks from './demo/DemoLinks.svelte';
	import type { LayoutProps } from './$types';
	import AppNav from '../lib/components/AppNav.svelte';
	import { nav, trackNavigation } from '../lib/navigation.svelte.js';
	import { toPath } from '../lib/navigation-trail.js';
	import { loadWidgetOverrides } from '../lib/widget-runtime.svelte.js';
	import './layout.css';

	let { children }: LayoutProps = $props();

	// Edited built-in widgets (Components page) are compiled in the browser for canvas/preview.
	onMount(() => void loadWidgetOverrides());

	afterNavigate((navigation) => {
		if (!navigation.to) return;
		trackNavigation(
			navigation.type,
			toPath(navigation.to.url),
			navigation.type === 'popstate' ? navigation.delta : null
		);
	});

	beforeNavigate((navigation) => {
		if (!nav.unsavedChanges) return;
		if (navigation.type === 'leave') {
			// Triggers the browser's native "leave site?" dialog.
			navigation.cancel();
			return;
		}
		const leavesRoute = navigation.to?.route.id !== navigation.from?.route.id;
		if (leavesRoute && !confirm('You have unsaved changes. Leave without saving?')) {
			navigation.cancel();
		}
	});
</script>

<div class="app">
	<header>
		<AppNav />
	</header>

	<main>
		{@render children()}
	</main>

	<footer>
		<p>
			visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to learn about SvelteKit ·
			<a href="https://github.com/sveltejs/kit">GitHub</a>
		</p>
	</footer>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		width: 100%;
		max-width: 64rem;
		margin: 0 auto;
		box-sizing: border-box;
	}

	footer {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 12px;
	}

	footer a {
		font-weight: bold;
	}

	@media (min-width: 480px) {
		footer {
			padding: 12px 0;
		}
	}
</style>
