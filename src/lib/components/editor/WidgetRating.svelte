<script lang="ts">
	/**
	 * @component WidgetRating
	 * Flowbite `Rating` star row.
	 *
	 * @prop {string} [title] - Caption next to the stars.
	 * @prop {string} [body] - Helper text.
	 * @prop {number} [level=80] - Rating as a percentage 0–100 (100 = five full stars).
	 */
	import { Rating, Helper } from 'flowbite-svelte';

	let {
		title = '',
		body = '',
		level = 80
	}: { title?: string; body?: string; level?: number } = $props();
	const stars = $derived(Math.round((Math.max(0, Math.min(100, level)) / 100) * 50) / 10);
</script>

<div class="flex h-full w-full flex-col justify-center gap-1 overflow-hidden">
	<div class="flex items-center gap-2 text-sm">
		<Rating total={5} rating={stars} size={20} />
		<span class="font-medium">{title}</span>
	</div>
	{#if body}<Helper>{body}</Helper>{/if}
</div>
