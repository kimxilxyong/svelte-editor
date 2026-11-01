<script lang="ts">
	/**
	 * @component WidgetListGroup
	 * Flowbite `Listgroup` of selectable rows.
	 *
	 * @prop {string} [items] - Rows, one per line. Defaults to three samples.
	 */
	import { Listgroup } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const rows = $derived(
		(items || 'Profile\nSettings\nMessages')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((name) => ({ name }))
	);
</script>

<div class="flex h-full w-full items-start overflow-hidden">
	<Listgroup items={rows} class="w-full" />
</div>
