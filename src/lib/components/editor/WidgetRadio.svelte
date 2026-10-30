<script lang="ts">
	/**
	 * @component WidgetRadio
	 * Flowbite `Radio` with title and helper text.
	 *
	 * @prop {string} [id] - Block id, used for the input id.
	 * @prop {string} title - Option label.
	 * @prop {string} body - Helper text.
	 * @prop {boolean} [checked] - `$bindable()` selected state.
	 * @prop {() => void} [onchange] - Called when the selection changes.
	 */
	import { Radio, Helper } from 'flowbite-svelte';

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
	// Flowbite's Radio works with a shared `group`; a single radio maps it to the boolean.
	let group = $state(checked ? 'on' : '');
	$effect(() => {
		checked = group === 'on';
	});
</script>

<div class="flex h-full w-full flex-col justify-center gap-1 overflow-hidden">
	<Radio id="radio-{id}" value="on" bind:group onchange={() => onchange?.()}>{title}</Radio>
	{#if body}<Helper class="ps-6">{body}</Helper>{/if}
</div>
