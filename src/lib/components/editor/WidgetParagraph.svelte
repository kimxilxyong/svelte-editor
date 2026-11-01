<script lang="ts">
	/**
	 * @component WidgetParagraph
	 * Flowbite `P` paragraph of body text.
	 *
	 * @prop {string} [body] - Paragraph text.
	 */
	import { P } from 'flowbite-svelte';

	let { body = '' }: { body?: string } = $props();
</script>

<div class="flex h-full w-full items-start overflow-hidden">
	<P>{body}</P>
</div>
