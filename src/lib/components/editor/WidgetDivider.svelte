<script lang="ts">
	/**
	 * @component WidgetDivider
	 * Flowbite `Hr` horizontal rule, optionally with a centred text.
	 *
	 * @prop {string} [title] - Centred text; empty draws a plain rule.
	 */
	import { Hr } from 'flowbite-svelte';

	let { title = '' }: { title?: string } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	{#if title}<Hr class="w-full">{title}</Hr>{:else}<Hr class="w-full" />{/if}
</div>
