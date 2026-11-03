<script lang="ts">
	/**
	 * @component WidgetButton
	 * Flowbite `Button` widget. With a non-empty, safe `href` it renders an accessible anchor
	 * (internal route or external http(s) address); otherwise a plain `<button>`.
	 *
	 * Unsafe hrefs (anything but `/route` or http(s); `//host` and `javascript:` included) never
	 * become a link: the widget falls back to a button, so a tampered value can not navigate.
	 * External links get `rel="noopener noreferrer"`, and `target="_blank"` only when `newTab` is set.
	 *
	 * @prop {string} action - Button label text.
	 * @prop {string} body - Tooltip text shown on hover.
	 * @prop {string} [href=''] - Link target; empty means "plain button".
	 * @prop {boolean} [newTab=false] - Open external links in a new tab.
	 * @prop {string} [image=''] - Optional icon/image URL displayed alongside the button label.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Called when the anchor is clicked so the host
	 *   can intercept in-app navigation. Distinct from value-edit callbacks: clicking never edits the page.
	 */
	import { Button } from 'flowbite-svelte';

	let {
		action,
		body,
		href = '',
		newTab = false,
		image = '',
		onnavigate
	}: {
		action: string;
		body: string;
		href?: string;
		newTab?: boolean;
		image?: string;
		onnavigate?: (event: MouseEvent) => void;
	} = $props();
	const externalHref = $derived(/^https?:\/\/[^\s]+$/i.test(href));
	const safeHref = $derived(externalHref || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href));
	const safeImage = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(image)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	{#if href !== '' && safeHref}
		<Button
			size="sm"
			title={body || undefined}
			{href}
			target={externalHref && newTab ? '_blank' : undefined}
			rel={externalHref ? 'noopener noreferrer' : undefined}
			onclick={(event: MouseEvent) => onnavigate?.(event)}
		>
			{#if safeImage}
				<img src={image} alt="" class="mr-1.5 h-4 w-4 shrink-0 object-contain" />
			{/if}
			{action}
		</Button>
	{:else}
		<Button size="sm" title={body || undefined}>
			{#if safeImage}
				<img src={image} alt="" class="mr-1.5 h-4 w-4 shrink-0 object-contain" />
			{/if}
			{action}
		</Button>
	{/if}
</div>
