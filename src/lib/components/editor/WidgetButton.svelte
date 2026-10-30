<script lang="ts">
	/**
	 * @component WidgetButton
	 * Flowbite `Button` widget providing an interactive action trigger.
	 *
	 * @prop {string} action - Button label text.
	 * @prop {string} body - Tooltip text shown on hover.
	 * @prop {() => void} [onchange] - Optional click handler.
	 */
	import { Button } from 'flowbite-svelte';

	let { action, body, onchange }: { action: string; body: string; onchange?: () => void } =
		$props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Button size="sm" title={body} onclick={() => onchange?.()}>{action}</Button>
</div>
