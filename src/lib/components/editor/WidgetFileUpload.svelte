<script lang="ts">
	/**
	 * @component WidgetFileUpload
	 * Flowbite `Fileupload` with a label and helper text.
	 *
	 * @prop {string} [id] - Block id, links label and input.
	 * @prop {string} [title] - Label text.
	 * @prop {string} [body] - Helper text (e.g. accepted file types).
	 */
	import { Fileupload, Label, Helper } from 'flowbite-svelte';

	let { id = '', title = '', body = '' }: { id?: string; title?: string; body?: string } = $props();
	const inputId = $derived(`upload-${id}`);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<Label for={inputId} class="text-sm">{title}</Label>
	<Fileupload id={inputId} size="sm" />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
