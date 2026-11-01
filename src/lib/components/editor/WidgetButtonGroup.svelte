<script lang="ts">
	/**
	 * @component WidgetButtonGroup
	 * Flowbite `ButtonGroup`: several joined buttons.
	 *
	 * @prop {string} [items] - Button labels, one per line. Defaults to three sample labels.
	 * @prop {string} [body] - Tooltip of the group.
	 */
	import { ButtonGroup, Button } from 'flowbite-svelte';

	let { items = '', body = '' }: { items?: string; body?: string } = $props();
	const labels = $derived(
		(items || 'Profile\nSettings\nMessages')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden" title={body}>
	<ButtonGroup>
		{#each labels as label (label)}<Button size="sm" color="alternative">{label}</Button>{/each}
	</ButtonGroup>
</div>
