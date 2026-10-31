<script lang="ts">
	/**
	 * @component WidgetCard
	 * Flowbite `Card` grouping a heading, text and an optional call-to-action (CTA).
	 *
	 * The CTA is shown when `action` is non-empty. With a non-empty, safe `href` it is an accessible
	 * anchor, otherwise a plain `<button>`. Unsafe hrefs fall back to the button (see WidgetButton).
	 * External links get `rel="noopener noreferrer"`, `target="_blank"` only when `newTab` is set.
	 *
	 * @prop {string} title - Card heading.
	 * @prop {string} body - Card text.
	 * @prop {string} action - CTA label; empty hides the CTA.
	 * @prop {string} [href=''] - CTA link target; empty means "plain button".
	 * @prop {boolean} [newTab=false] - Open external links in a new tab.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Called when the CTA anchor is clicked so the
	 *   host can intercept in-app navigation.
	 */
	import { Card, Button } from 'flowbite-svelte';

	let {
		title,
		body,
		action,
		href = '',
		newTab = false,
		onnavigate
	}: {
		title: string;
		body: string;
		action: string;
		href?: string;
		newTab?: boolean;
		onnavigate?: (event: MouseEvent) => void;
	} = $props();
	const externalHref = $derived(/^https?:\/\/[^\s]+$/i.test(href));
	const safeHref = $derived(externalHref || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href));
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Card size="xl" class="h-full w-full max-w-none justify-between gap-1 overflow-hidden p-3">
		<div class="min-h-0">
			<h5 class="truncate text-base font-bold">{title}</h5>
			<p class="text-sm opacity-80">{body}</p>
		</div>
		{#if action}
			<div>
				{#if href !== '' && safeHref}
					<Button
						size="xs"
						{href}
						target={externalHref && newTab ? '_blank' : undefined}
						rel={externalHref ? 'noopener noreferrer' : undefined}
						onclick={(event: MouseEvent) => onnavigate?.(event)}>{action}</Button
					>
				{:else}
					<Button size="xs">{action}</Button>
				{/if}
			</div>
		{/if}
	</Card>
</div>
