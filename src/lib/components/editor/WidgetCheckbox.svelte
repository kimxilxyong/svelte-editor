<script lang="ts">
	/**
	 * @component WidgetCheckbox
	 * Flowbite `Checkbox` with title and helper text.
	 *
	 * @prop {string} [id] - Block id, used for the input id.
	 * @prop {string} title - Option label.
	 * @prop {string} body - Helper text.
	 * @prop {boolean} [checked] - `$bindable()` checked state.
	 * @prop {() => void} [onchange] - Called when toggled.
	 */
	import { Checkbox, Helper } from 'flowbite-svelte';

	let {
		id = '',
		title,
		body,
		checked = $bindable(false),
		onchange
	}: {
		id?: string;
		title: string;
		body: string;
		checked?: boolean;
		onchange?: () => void;
	} = $props();
</script>

<div class="flex h-full w-full flex-col justify-center gap-1 overflow-hidden">
	<Checkbox id="checkbox-{id}" bind:checked onchange={() => onchange?.()}>{title}</Checkbox>
	{#if body}<Helper class="ps-6">{body}</Helper>{/if}
</div>
