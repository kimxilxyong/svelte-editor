<script lang="ts">
	/**
	 * @component WidgetTags
	 * Flowbite `Tags` input: visitors type entries that become removable chips.
	 *
	 * @prop {string} [title] - Label text.
	 * @prop {string} [action] - Placeholder text.
	 * @prop {string} [items] - Initial tags, one per line.
	 */
	import { Tags, Label } from 'flowbite-svelte';

	let {
		title = '',
		action = 'Add a tag',
		items = ''
	}: { title?: string; action?: string; items?: string } = $props();
	// Seeded once from the block; afterwards the visitor owns the list.
	// svelte-ignore state_referenced_locally
	let value = $state<string[]>(
		items
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<Label class="text-sm">{title}</Label>
	<Tags bind:value placeholder={action} />
</div>
