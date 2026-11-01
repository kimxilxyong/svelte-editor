<script lang="ts">
	/**
	 * @component WidgetRadialProgress
	 * Flowbite `Progressradial` circular progress indicator.
	 *
	 * @prop {string} [title] - Caption beside the circle; empty hides it.
	 * @prop {number} [level=60] - Completion percentage 0–100.
	 */
	import { Progressradial } from 'flowbite-svelte';

	let { title = '', level = 60 }: { title?: string; level?: number } = $props();
</script>

<div class="flex h-full w-full items-center gap-3 overflow-hidden">
	<Progressradial progress={level} size="w-16 h-16" animate={false} labelInside />
	{#if title}<span class="text-sm font-medium">{title}</span>{/if}
</div>
