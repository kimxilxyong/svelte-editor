<script lang="ts">
	/**
	 * @component WidgetAlert
	 * Flowbite `Alert` with a bold title and message.
	 *
	 * @prop {string} title - Bold lead-in text.
	 * @prop {string} body - Message text.
	 */
	import { Alert } from 'flowbite-svelte';

	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Alert color="blue" class="w-full p-2 text-sm"
		><span class="font-medium">{title}</span> {body}</Alert
	>
</div>
