<script lang="ts">
	/**
	 * @component WidgetLink
	 * Flowbite `A` link to an internal route or an external http(s) address.
	 *
	 * Unsafe hrefs (anything but `/route` or http(s)) render without an `href`, so a tampered value
	 * can never become a `javascript:` link.
	 *
	 * @prop {string} title - Link text.
	 * @prop {string} body - Tooltip text.
	 * @prop {string} href - Target address.
	 * @prop {boolean} newTab - Open external links in a new tab.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Click handler so the host can intercept navigation.
	 */
	import { A } from 'flowbite-svelte';

	let {
		title,
		body,
		href,
		newTab,
		onnavigate
	}: {
		title: string;
		body: string;
		href: string;
		newTab: boolean;
		onnavigate?: (event: MouseEvent) => void;
	} = $props();
	const externalHref = $derived(/^https?:\/\//i.test(href));
	const safeHref = $derived(externalHref || /^\/[a-z0-9\-_/#?=&.]*$/i.test(href));
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<div title={body}>
		<A
			href={safeHref ? href : undefined}
			target={externalHref && newTab ? '_blank' : undefined}
			rel="noopener noreferrer"
			onclick={(event: MouseEvent) => onnavigate?.(event)}>{title} ↪</A
		>
	</div>
</div>
