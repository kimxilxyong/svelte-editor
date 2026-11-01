<script lang="ts">
	/**
	 * @component WidgetSpinner
	 * Flowbite `Spinner` loading indicator with an optional caption.
	 *
	 * @prop {string} [title] - Caption next to the spinner; empty hides it.
	 * @prop {string} [action] - Style: `default`, `dots`, `bars`, `pulse` or `orbit`.
	 */
	import { Spinner } from 'flowbite-svelte';

	let { title = '', action = 'default' }: { title?: string; action?: string } = $props();
	const styles = ['default', 'dots', 'bars', 'pulse', 'orbit'] as const;
	const type = $derived(styles.find((name) => name === action.trim().toLowerCase()) ?? 'default');
</script>

<div class="flex h-full w-full items-center gap-3 overflow-hidden">
	<Spinner {type} size="8" />
	{#if title}<span class="text-sm">{title}</span>{/if}
</div>
