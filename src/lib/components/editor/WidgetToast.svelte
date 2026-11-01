<script lang="ts">
	/**
	 * @component WidgetToast
	 * Flowbite `Toast` notification, shown inline (not floating) so it can be placed on the canvas.
	 *
	 * @prop {string} [title] - Message heading.
	 * @prop {string} [body] - Message text.
	 */
	import { Toast } from 'flowbite-svelte';

	let { title = '', body = '' }: { title?: string; body?: string } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Toast class="w-full max-w-none">
		<div class="text-sm font-semibold">{title}</div>
		{#if body}<div class="text-sm font-normal opacity-80">{body}</div>{/if}
	</Toast>
</div>
