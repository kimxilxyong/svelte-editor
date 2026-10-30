<script lang="ts">
	/**
	 * @component WidgetCard
	 * Flowbite `Card` grouping a heading, text and an action button.
	 *
	 * @prop {string} title - Card heading.
	 * @prop {string} body - Card text.
	 * @prop {string} action - Button label.
	 * @prop {() => void} [onchange] - Called when the button is clicked.
	 */
	import { Card, Button } from 'flowbite-svelte';

	let {
		title,
		body,
		action,
		onchange
	}: { title: string; body: string; action: string; onchange?: () => void } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Card size="xl" class="h-full w-full max-w-none justify-between gap-1 overflow-hidden p-3">
		<div class="min-h-0">
			<h5 class="truncate text-base font-bold">{title}</h5>
			<p class="text-sm opacity-80">{body}</p>
		</div>
		{#if action}<div><Button size="xs" onclick={() => onchange?.()}>{action}</Button></div>{/if}
	</Card>
</div>
