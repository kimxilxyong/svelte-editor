<script lang="ts">
	/**
	 * @component WidgetDrawer
	 * A Flowbite `Button` that slides a `Drawer` panel in from the left.
	 *
	 * @prop {string} [action] - Button label.
	 * @prop {string} [title] - Drawer heading.
	 * @prop {string} [body] - Drawer text.
	 */
	import { Button, Drawer, CloseButton } from 'flowbite-svelte';

	let {
		action = 'Open drawer',
		title = '',
		body = ''
	}: { action?: string; title?: string; body?: string } = $props();
	let open = $state(false);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Button size="sm" onclick={() => (open = true)}>{action}</Button>
	<Drawer bind:open>
		<div class="mb-4 flex items-center justify-between">
			<h5 class="text-base font-semibold">{title}</h5>
			<CloseButton onclick={() => (open = false)} />
		</div>
		<p class="text-sm leading-relaxed">{body}</p>
	</Drawer>
</div>
