<script lang="ts">
	/**
	 * @component WidgetTextField
	 * Flowbite `Input` single-line text field with label and helper text.
	 *
	 * @prop {string} [id] - Block id, used to link label and input.
	 * @prop {string} title - Label text.
	 * @prop {string} action - Placeholder text.
	 * @prop {string} body - Helper text.
	 * @prop {string} [value] - `$bindable()` input value.
	 * @prop {() => void} [onchange] - Called when the user edits the value.
	 */
	import { Input, Label, Helper } from 'flowbite-svelte';

	let {
		id = '',
		title,
		action,
		body,
		value = $bindable(''),
		onchange
	}: {
		id?: string;
		title: string;
		action: string;
		body: string;
		value?: string;
		onchange?: () => void;
	} = $props();
	const inputId = $derived(`text-field-${id}`);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<Label for={inputId} class="text-sm">{title}</Label>
	<Input
		size="sm"
		id={inputId}
		type="text"
		placeholder={action}
		maxlength={100}
		bind:value
		oninput={() => onchange?.()}
	/>
	{#if body}<Helper>{body}</Helper>{/if}
</div>
