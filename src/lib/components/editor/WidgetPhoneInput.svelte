<script lang="ts">
	/**
	 * @component WidgetPhoneInput
	 * Flowbite `PhoneInput` for telephone numbers.
	 *
	 * @prop {string} [id] - Block id, links label and input.
	 * @prop {string} [title] - Label text.
	 * @prop {string} [body] - Helper text.
	 */
	import { PhoneInput, Label, Helper } from 'flowbite-svelte';

	let { id = '', title = '', body = '' }: { id?: string; title?: string; body?: string } = $props();
	const inputId = $derived(`phone-${id}`);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<Label for={inputId} class="text-sm">{title}</Label>
	<PhoneInput id={inputId} placeholder="123-456-7890" />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
