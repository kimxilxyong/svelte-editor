<script lang="ts">
	/**
	 * @component WidgetSelect
	 * Flowbite `Select` dropdown field.
	 *
	 * @prop {string} [id] - Block id, used to link label and select.
	 * @prop {string} title - Label text.
	 * @prop {string} body - Helper text.
	 * @prop {string} [items] - Options, one per line. Defaults to a sample country list.
	 * @prop {string} [value] - `$bindable()` selected option.
	 * @prop {() => void} [onchange] - Called when the selection changes.
	 */
	import { Select, Label, Helper } from 'flowbite-svelte';

	let {
		id = '',
		title,
		body,
		items = '',
		value = $bindable(''),
		onchange
	}: {
		id?: string;
		title: string;
		body: string;
		items?: string;
		value?: string;
		onchange?: () => void;
	} = $props();
	const options = $derived(
		(items || 'Canada\nUnited States\nUnited Kingdom')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((name) => ({ value: name, name }))
	);
	const inputId = $derived(`select-${id}`);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<Label for={inputId} class="text-sm">{title}</Label>
	<Select
		size="sm"
		id={inputId}
		items={options}
		placeholder="Choose an option"
		bind:value
		onchange={() => onchange?.()}
	/>
	{#if body}<Helper>{body}</Helper>{/if}
</div>
