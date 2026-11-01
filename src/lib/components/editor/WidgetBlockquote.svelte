<script lang="ts">
	/**
	 * @component WidgetBlockquote
	 * Flowbite `Blockquote` with an optional attribution.
	 *
	 * @prop {string} [body] - Quote text.
	 * @prop {string} [title] - Attribution (author); empty hides it.
	 */
	import { Blockquote } from 'flowbite-svelte';

	let { body = '', title = '' }: { body?: string; title?: string } = $props();
</script>

<div class="flex h-full w-full flex-col justify-center overflow-hidden">
	<Blockquote border bg size="base">{body}</Blockquote>
	{#if title}<p class="mt-1 text-xs opacity-70">— {title}</p>{/if}
</div>
