<script lang="ts">
	/**
	 * @component WidgetTable
	 * Flowbite `Table`.
	 *
	 * @prop {string} [items] - Rows, one per line, cells separated by `|`. The first line is the
	 *   header row. Defaults to a small sample.
	 */
	import {
		Table,
		TableHead,
		TableHeadCell,
		TableBody,
		TableBodyRow,
		TableBodyCell
	} from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const rows = $derived(
		(items || 'Product | Color | Price\nLaptop | Silver | $2999\nPhone | Black | $799')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.split('|').map((cell) => cell.trim()))
	);
	const header = $derived(rows[0] ?? []);
	const body = $derived(rows.slice(1));
</script>

<div class="h-full w-full overflow-auto">
	<Table striped>
		<TableHead>
			{#each header as cell, index (index)}<TableHeadCell>{cell}</TableHeadCell>{/each}
		</TableHead>
		<TableBody>
			{#each body as row, rowIndex (rowIndex)}
				<TableBodyRow>
					{#each row as cell, index (index)}<TableBodyCell>{cell}</TableBodyCell>{/each}
				</TableBodyRow>
			{/each}
		</TableBody>
	</Table>
</div>
