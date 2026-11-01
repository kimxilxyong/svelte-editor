<script lang="ts">
	/**
	 * @component WidgetKbd
	 * Flowbite `Kbd` keyboard keys, joined with a plus sign.
	 *
	 * @prop {string} [items] - One key per line (e.g. `Ctrl`, `K`). Defaults to Ctrl + K.
	 */
	import { Kbd } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const keys = $derived(
		(items || 'Ctrl\nK')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
</script>

<div class="flex h-full w-full items-center gap-1 overflow-hidden">
	{#each keys as key, index (index)}
		{#if index > 0}<span class="text-xs opacity-60">+</span>{/if}
		<Kbd>{key}</Kbd>
	{/each}
</div>
