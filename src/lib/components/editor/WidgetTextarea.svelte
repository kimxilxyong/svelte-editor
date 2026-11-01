<script lang="ts">
	/**
	 * @component WidgetTextarea
	 * Flowbite `Textarea` multi-line input with label and helper text.
	 *
	 * @prop {string} [id] - Block id, used to link label and textarea.
	 * @prop {string} title - Label text.
	 * @prop {string} action - Placeholder text.
	 * @prop {string} body - Helper text.
	 * @prop {string} [value] - `$bindable()` textarea value.
	 * @prop {() => void} [onchange] - Called when the user edits the value.
	 */
	import { Textarea, Label, Helper, getTheme } from 'flowbite-svelte';

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
	const inputId = $derived(`textarea-${id}`);
	// Flowbite only applies the provider's `textarea.wrapper` classes to wrapped textareas (with a
	// header/footer/addon); a plain one ignores them, so the site theme is passed in explicitly.
	const themed = $derived(getTheme('textarea')?.wrapper);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2">
	<Label for={inputId} class="text-sm">{title}</Label>
	<Textarea
		class={[themed, 'h-full min-h-0 resize-none']}
		id={inputId}
		placeholder={action}
		maxlength={100}
		bind:value
		oninput={() => onchange?.()}
	/>
	{#if body}<Helper>{body}</Helper>{/if}
</div>
