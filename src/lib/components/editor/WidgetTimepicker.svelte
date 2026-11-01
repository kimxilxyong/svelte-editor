<script lang="ts">
	/**
	 * @component WidgetTimepicker
	 * Flowbite `Timepicker` input.
	 *
	 * @prop {string} [id] - Block id, links label and input.
	 * @prop {string} [title] - Label text.
	 * @prop {string} [body] - Helper text.
	 */
	import { Timepicker, Label, Helper } from 'flowbite-svelte';

	let { id = '', title = '', body = '' }: { id?: string; title?: string; body?: string } = $props();
	const inputId = $derived(`time-${id}`);
	let value = $state('09:00');
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-visible">
	<Label for={inputId} class="text-sm">{title}</Label>
	<Timepicker id={inputId} bind:value />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
