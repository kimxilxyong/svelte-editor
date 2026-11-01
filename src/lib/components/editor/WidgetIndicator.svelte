<script lang="ts">
	/**
	 * @component WidgetIndicator
	 * Flowbite `Indicator` status dot with a label.
	 *
	 * @prop {string} [title] - Label.
	 * @prop {string} [action] - Colour: `green`, `red`, `yellow`, `blue`, `gray`, `purple` or
	 *   `indigo`; unknown values use `green`.
	 */
	import { Indicator } from 'flowbite-svelte';

	let { title = '', action = 'green' }: { title?: string; action?: string } = $props();
	const colors = ['green', 'red', 'yellow', 'blue', 'gray', 'purple', 'indigo'] as const;
	const color = $derived(colors.find((name) => name === action.trim().toLowerCase()) ?? 'green');
</script>

<div class="flex h-full w-full items-center gap-2 overflow-hidden text-sm">
	<Indicator {color} size="lg" />
	<span>{title}</span>
</div>
