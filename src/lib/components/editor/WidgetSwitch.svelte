<script lang="ts">
	/**
	 * @component WidgetSwitch
	 * Flowbite `Toggle` switch with title and helper text.
	 *
	 * @prop {string} [id] - Block id, used for the input id.
	 * @prop {string} title - Switch label.
	 * @prop {string} body - Helper text.
	 * @prop {boolean} [checked] - `$bindable()` on/off state.
	 * @prop {() => void} [onchange] - Called when toggled.
	 */
	import { Toggle, Helper } from 'flowbite-svelte';

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
	<Toggle id="switch-{id}" bind:checked onchange={() => onchange?.()}>{title}</Toggle>
	{#if body}<Helper class="ps-14">{body}</Helper>{/if}
</div>
