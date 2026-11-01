<script lang="ts">
	/**
	 * @component WidgetTooltip
	 * A Flowbite `Button` that shows a `Tooltip` on hover or focus.
	 *
	 * @prop {string} [id] - Block id, makes the trigger id unique.
	 * @prop {string} [action] - Button label.
	 * @prop {string} [title] - Tooltip text.
	 */
	import { Button, Tooltip } from 'flowbite-svelte';

	let {
		id = '',
		action = 'Hover me',
		title = ''
	}: { id?: string; action?: string; title?: string } = $props();
	const triggerId = $derived(`tooltip-${id}`);
</script>

<div class="flex h-full w-full items-center overflow-visible">
	<Button id={triggerId} size="sm" color="alternative">{action}</Button>
	<Tooltip triggeredBy={`#${triggerId}`}>{title}</Tooltip>
</div>
