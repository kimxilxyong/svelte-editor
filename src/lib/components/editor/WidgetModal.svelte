<script lang="ts">
	/**
	 * @component WidgetModal
	 * A Flowbite `Button` that opens a `Modal` dialog with a title and text.
	 *
	 * @prop {string} [action] - Button label.
	 * @prop {string} [title] - Modal heading.
	 * @prop {string} [body] - Modal text.
	 */
	import { Button, Modal } from 'flowbite-svelte';

	let {
		action = 'Open modal',
		title = '',
		body = ''
	}: { action?: string; title?: string; body?: string } = $props();
	let open = $state(false);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Button size="sm" onclick={() => (open = true)}>{action}</Button>
	<Modal {title} bind:open autoclose outsideclose>
		<p class="text-sm leading-relaxed">{body}</p>
		{#snippet footer()}<Button size="sm" onclick={() => (open = false)}>Close</Button>{/snippet}
	</Modal>
</div>
