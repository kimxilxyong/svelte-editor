<script lang="ts">
	/**
	 * @component WidgetGradientButton
	 * Flowbite `GradientButton`: a call-to-action with a colour gradient.
	 *
	 * With a non-empty, safe `href` it renders an anchor, otherwise a plain button (same rules as
	 * WidgetButton).
	 *
	 * @prop {string} [action] - Button label.
	 * @prop {string} [body] - Tooltip text.
	 * @prop {string} [href=''] - Link target; empty means "plain button".
	 * @prop {boolean} [newTab=false] - Open external links in a new tab.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports anchor clicks to the host.
	 */
	import { GradientButton } from 'flowbite-svelte';

	let {
		action = 'Get started',
		body = '',
		href = '',
		newTab = false,
		onnavigate
	}: {
		action?: string;
		body?: string;
		href?: string;
		newTab?: boolean;
		onnavigate?: (event: MouseEvent) => void;
	} = $props();
	const externalHref = $derived(/^https?:\/\/[^\s]+$/i.test(href));
	const safeHref = $derived(externalHref || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href));
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	{#if href !== '' && safeHref}
		<GradientButton
			color="purpleToBlue"
			title={body}
			{href}
			target={externalHref && newTab ? '_blank' : undefined}
			rel={externalHref ? 'noopener noreferrer' : undefined}
			onclick={(event: MouseEvent) => onnavigate?.(event)}>{action}</GradientButton
		>
	{:else}
		<GradientButton color="purpleToBlue" title={body}>{action}</GradientButton>
	{/if}
</div>
