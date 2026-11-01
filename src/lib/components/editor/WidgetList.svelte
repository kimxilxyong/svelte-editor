<script lang="ts">
	/**
	 * @component WidgetList
	 * Flowbite `List` / `Li` bulleted list.
	 *
	 * @prop {string} [items] - List entries, one per line. Defaults to three samples.
	 */
	import { List, Li } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const entries = $derived(
		(items || 'First point\nSecond point\nThird point')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
</script>

<div class="flex h-full w-full items-start overflow-hidden">
	<List tag="ul" class="space-y-1">
		{#each entries as entry, index (index)}<Li>{entry}</Li>{/each}
	</List>
</div>
