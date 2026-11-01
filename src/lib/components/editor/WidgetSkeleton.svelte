<script lang="ts">
	/**
	 * @component WidgetSkeleton
	 * Flowbite loading placeholder ("skeleton") shown while content loads.
	 *
	 * @prop {string} [action] - Variant: `text`, `image`, `card`, `list`, `video`, `testimonial` or
	 *   `widget`; unknown values use `text`.
	 */
	import {
		TextPlaceholder,
		ImagePlaceholder,
		CardPlaceholder,
		ListPlaceholder,
		VideoPlaceholder,
		TestimonialPlaceholder,
		WidgetPlaceholder
	} from 'flowbite-svelte';

	let { action = 'text' }: { action?: string } = $props();
	const variant = $derived(action.trim().toLowerCase());
</script>

<div class="h-full w-full overflow-hidden">
	{#if variant === 'image'}
		<ImagePlaceholder class="max-w-none" />
	{:else if variant === 'card'}
		<CardPlaceholder class="max-w-none" />
	{:else if variant === 'list'}
		<ListPlaceholder class="max-w-none" />
	{:else if variant === 'video'}
		<VideoPlaceholder class="max-w-none" />
	{:else if variant === 'testimonial'}
		<TestimonialPlaceholder class="max-w-none" />
	{:else if variant === 'widget'}
		<WidgetPlaceholder class="max-w-none" />
	{:else}
		<TextPlaceholder class="max-w-none" />
	{/if}
</div>
