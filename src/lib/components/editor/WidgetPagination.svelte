<script lang="ts">
	/**
	 * @component WidgetPagination
	 * Flowbite `Pagination` page switcher.
	 *
	 * @prop {string} [items] - Page labels, one per line. Defaults to 1–5.
	 */
	import { Pagination } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	let current = $state(0);
	const labels = $derived(
		(items || '1\n2\n3\n4\n5')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
	const pages = $derived(
		labels.map((name, index) => ({
			name,
			active: index === current,
			onclick: () => (current = index)
		}))
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Pagination
		{pages}
		previous={() => (current = Math.max(0, current - 1))}
		next={() => (current = Math.min(labels.length - 1, current + 1))}
	/>
</div>
