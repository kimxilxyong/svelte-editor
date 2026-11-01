<script lang="ts">
	/**
	 * @component WidgetFloatingInput
	 * Flowbite `FloatingLabelInput`: a text field whose label floats above the value.
	 *
	 * @prop {string} [id] - Block id, links label and input.
	 * @prop {string} [title] - Floating label text.
	 * @prop {string} [body] - Helper text.
	 */
	import { FloatingLabelInput, Helper } from 'flowbite-svelte';

	let { id = '', title = '', body = '' }: { id?: string; title?: string; body?: string } = $props();
	const inputId = $derived(`floating-${id}`);
	let value = $state('');
</script>

<div class="flex h-full w-full flex-col justify-center gap-1">
	<FloatingLabelInput id={inputId} variant="outlined" bind:value>{title}</FloatingLabelInput>
	{#if body}<Helper>{body}</Helper>{/if}
</div>
