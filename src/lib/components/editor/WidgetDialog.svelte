<script lang="ts">
	/**
	 * @component WidgetDialog
	 * A Flowbite `Button` that opens a native `Dialog` with a title, text and a confirm button.
	 *
	 * @prop {string} [action] - Button label.
	 * @prop {string} [title] - Dialog heading.
	 * @prop {string} [body] - Dialog text.
	 */
	import { Button, Dialog } from 'flowbite-svelte';

	let {
		action = 'Open dialog',
		title = '',
		body = ''
	}: { action?: string; title?: string; body?: string } = $props();
	let open = $state(false);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Button size="sm" color="alternative" onclick={() => (open = true)}>{action}</Button>
	<Dialog bind:open modal autoclose dismissable outsideclose class="p-5">
		<h3 class="mb-2 text-lg font-semibold">{title}</h3>
		<p class="mb-4 text-sm leading-relaxed">{body}</p>
		<Button size="sm" onclick={() => (open = false)}>OK</Button>
	</Dialog>
</div>
