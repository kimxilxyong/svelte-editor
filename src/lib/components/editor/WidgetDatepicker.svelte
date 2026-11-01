<script lang="ts">
	/**
	 * @component WidgetDatepicker
	 * Flowbite `Datepicker` input with a calendar popup.
	 *
	 * @prop {string} [title] - Label text.
	 * @prop {string} [action] - Placeholder text.
	 * @prop {string} [body] - Helper text.
	 */
	import { Datepicker, Label, Helper } from 'flowbite-svelte';

	let {
		title = '',
		action = 'Select date',
		body = ''
	}: { title?: string; action?: string; body?: string } = $props();
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-visible">
	<Label class="text-sm">{title}</Label>
	<Datepicker placeholder={action} />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
