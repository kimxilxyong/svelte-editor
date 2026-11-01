<script lang="ts">
	/**
	 * @component WidgetImage
	 * Flowbite `Img` with an optional caption.
	 *
	 * @prop {string} [action] - Image URL (`https://…`, `/path` or a data URI); empty shows a neutral
	 *   placeholder.
	 * @prop {string} [title] - Alternative text for screen readers.
	 * @prop {string} [body] - Caption shown under the image; empty hides it.
	 */
	import { Img, ImagePlaceholder } from 'flowbite-svelte';

	let {
		action = '',
		title = '',
		body = ''
	}: { action?: string; title?: string; body?: string } = $props();
	// Only plain web paths and data images are accepted; anything else shows the placeholder.
	const safeSrc = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(action)
	);
</script>

<div class="flex h-full w-full items-center justify-center overflow-hidden">
	{#if safeSrc}
		<Img src={action} alt={title} caption={body || undefined} class="max-h-full object-contain" />
	{:else}
		<ImagePlaceholder class="h-full w-full max-w-none" />
	{/if}
</div>
