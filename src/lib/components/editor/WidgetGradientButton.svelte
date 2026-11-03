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
	 * @prop {string} [image=''] - Optional icon/image URL displayed alongside the button label.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports anchor clicks to the host.
	 */
	import { GradientButton } from 'flowbite-svelte';

	let {
		action = 'Get started',
		body = '',
		href = '',
		newTab = false,
		image = '',
		onnavigate
	}: {
		action?: string;
		body?: string;
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
		<GradientButton
			color="purpleToBlue"
			title={body}
			{href}
			target={externalHref && newTab ? '_blank' : undefined}
			rel={externalHref ? 'noopener noreferrer' : undefined}
			onclick={(event: MouseEvent) => onnavigate?.(event)}
		>
			{#if safeImage}
				<img src={image} alt="" class="mr-1.5 h-4 w-4 shrink-0 object-contain" />
			{/if}
			{action}
		</GradientButton>
	{:else}
		<GradientButton color="purpleToBlue" title={body}>
			{#if safeImage}
				<img src={image} alt="" class="mr-1.5 h-4 w-4 shrink-0 object-contain" />
			{/if}
			{action}
		</GradientButton>
	{/if}
</div>
