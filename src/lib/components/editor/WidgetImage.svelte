<script lang="ts">
	/**
	 * @component WidgetImage
	 * Flowbite `Img` with an optional caption.
	 *
	 * @prop {string} [action] - Image URL (`https://…`, `/path` or a data URI); empty shows a neutral
	 *   placeholder unless `image` is set.
	 * @prop {string} [image=''] - Optional picked image URL from the managed catalog (takes precedence
	 *   when set, or falls back to `action`).
	 * @prop {string} [title] - Alternative text for screen readers.
	 * @prop {string} [body] - Caption shown under the image; empty hides it.
	 */
	import { Img, ImagePlaceholder } from 'flowbite-svelte';

	let {
		action = '',
		image = '',
		title = '',
		body = ''
	}: { action?: string; image?: string; title?: string; body?: string } = $props();
	const resolvedSrc = $derived(image || action);
	// Only plain web paths and data images are accepted; anything else shows the placeholder.
	const safeSrc = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(resolvedSrc)
	);
</script>

<div class="flex h-full w-full items-center justify-center overflow-hidden">
	{#if safeSrc}
		<Img
			src={resolvedSrc}
			alt={title}
			caption={body || undefined}
			class="max-h-full object-contain"
		/>
	{:else}
		<ImagePlaceholder class="h-full w-full max-w-none" />
	{/if}
</div>
