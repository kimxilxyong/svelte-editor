<script lang="ts">
	/**
	 * @component WidgetHeading
	 * Flowbite `Heading` typography element.
	 *
	 * @prop {string} [title] - Heading text.
	 * @prop {string} [action] - Tag name `h1`–`h6`; anything else falls back to `h2`.
	 */
	import { Heading } from 'flowbite-svelte';

	let { title = '', action = 'h2' }: { title?: string; action?: string } = $props();
	const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
	const tag = $derived(tags.find((name) => name === action.trim().toLowerCase()) ?? 'h2');
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Heading {tag} class="truncate">{title}</Heading>
</div>
