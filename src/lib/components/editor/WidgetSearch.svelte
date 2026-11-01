<script lang="ts">
	/**
	 * @component WidgetSearch
	 * Flowbite `Search` field with a clear button.
	 *
	 * @prop {string} [action] - Placeholder text.
	 * @prop {string} [body] - Helper text below the field.
	 */
	import { Search, Helper } from 'flowbite-svelte';

	let { action = 'Search…', body = '' }: { action?: string; body?: string } = $props();
	let value = $state('');
</script>

<div class="flex h-full w-full flex-col justify-center gap-2">
	<Search size="md" placeholder={action} bind:value />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
