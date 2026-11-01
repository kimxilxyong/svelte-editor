<script lang="ts">
	/**
	 * @component WidgetDropzone
	 * Flowbite `Dropzone` drag-and-drop file area.
	 *
	 * @prop {string} [title] - Main instruction.
	 * @prop {string} [body] - Hint (e.g. accepted formats).
	 */
	import { Dropzone } from 'flowbite-svelte';

	let { title = '', body = '' }: { title?: string; body?: string } = $props();
</script>

<div class="flex h-full w-full overflow-hidden">
	<Dropzone class="h-full w-full">
		<span class="text-sm font-semibold">{title}</span>
		{#if body}<span class="text-xs opacity-70">{body}</span>{/if}
	</Dropzone>
</div>
