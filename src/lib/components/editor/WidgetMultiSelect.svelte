<script lang="ts">
	/**
	 * @component WidgetMultiSelect
	 * Flowbite `MultiSelect` that lets visitors choose several options.
	 *
	 * @prop {string} [title] - Label text.
	 * @prop {string} [body] - Helper text.
	 * @prop {string} [action] - Placeholder shown while nothing is selected.
	 * @prop {string} [items] - Options, one per line.
	 */
	import { MultiSelect, Label, Helper } from 'flowbite-svelte';

	let {
		title = '',
		body = '',
		action = 'Choose options',
		items = ''
	}: { title?: string; body?: string; action?: string; items?: string } = $props();
	const options = $derived(
		(items || 'Red\nGreen\nBlue')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((name) => ({ value: name, name }))
	);
	let value = $state<string[]>([]);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2">
	<Label class="text-sm">{title}</Label>
	<MultiSelect size="sm" items={options} bind:value placeholder={action} />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
