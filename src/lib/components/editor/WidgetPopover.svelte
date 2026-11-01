<script lang="ts">
	/**
	 * @component WidgetPopover
	 * A Flowbite `Button` that opens a `Popover` card with a title and text.
	 *
	 * @prop {string} [id] - Block id, makes the trigger id unique.
	 * @prop {string} [action] - Button label.
	 * @prop {string} [title] - Popover heading.
	 * @prop {string} [body] - Popover text.
	 */
	import { Button, Popover } from 'flowbite-svelte';

	let {
		id = '',
		action = 'More info',
		title = '',
		body = ''
	}: { id?: string; action?: string; title?: string; body?: string } = $props();
	const triggerId = $derived(`popover-${id}`);
</script>

<div class="flex h-full w-full items-center overflow-visible">
	<Button id={triggerId} size="sm">{action}</Button>
	<Popover triggeredBy={`#${triggerId}`} {title} class="w-64 text-sm">{body}</Popover>
</div>
