<script lang="ts">
	/**
	 * @component WidgetLink
	 * Flowbite `A` link to an internal route or an external http(s) address.
	 *
	 * Unsafe hrefs (anything but `/route` or http(s); `//host` included) render without an `href`, so a tampered value
	 * can never become a `javascript:` link.
	 *
	 * @prop {string} title - Link text.
	 * @prop {string} body - Tooltip text.
	 * @prop {string} href - Target address.
	 * @prop {boolean} newTab - Open external links in a new tab.
	 * @prop {string} [image=''] - Optional icon/image URL displayed next to the link text.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Click handler so the host can intercept navigation.
	 */
	import { A } from 'flowbite-svelte';

	let {
		title,
		body,
		href,
		newTab,
		image = '',
		onnavigate
	}: {
		title: string;
		body: string;
		href: string;
		newTab: boolean;
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
	<div title={body}>
		<A
			href={safeHref ? href : undefined}
			target={externalHref && newTab ? '_blank' : undefined}
			rel="noopener noreferrer"
			onclick={(event: MouseEvent) => onnavigate?.(event)}
		>
			{#if safeImage}
				<img
					src={image}
					alt=""
					class="mr-1.5 inline-block h-4 w-4 shrink-0 object-contain align-text-bottom"
				/>
			{/if}
			{title} ↪
		</A>
	</div>
</div>
