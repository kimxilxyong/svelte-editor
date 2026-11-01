<script lang="ts">
	/**
	 * @component WidgetVideo
	 * Flowbite `Video` player.
	 *
	 * @prop {string} [action] - Video URL (`https://…` or `/path`); empty shows a video placeholder.
	 * @prop {string} [title] - Accessible title.
	 */
	import { Video, VideoPlaceholder } from 'flowbite-svelte';

	let { action = '', title = '' }: { action?: string; title?: string } = $props();
	const safeSrc = $derived(/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i.test(action));
</script>

<div class="flex h-full w-full items-center justify-center overflow-hidden">
	{#if safeSrc}
		<Video src={action} {title} controls class="h-full w-full object-contain" />
	{:else}
		<VideoPlaceholder class="h-full w-full max-w-none" />
	{/if}
</div>
