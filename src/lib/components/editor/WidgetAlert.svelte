<script lang="ts">
	/**
	 * @component WidgetAlert
	 * Flowbite `Alert` with a bold title, message and optional icon.
	 *
	 * @prop {string} title - Bold lead-in text.
	 * @prop {string} body - Message text.
	 * @prop {string} [image=''] - Optional icon URL shown before the alert heading.
	 */
	import { Alert } from 'flowbite-svelte';

	let { title, body, image = '' }: { title: string; body: string; image?: string } = $props();
	const safeImage = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(image)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Alert color="blue" class="w-full p-2 text-sm">
		{#if safeImage}
			<img
				src={image}
				alt=""
				class="mr-1.5 inline-block h-4 w-4 shrink-0 object-contain align-text-bottom"
			/>
		{/if}
		<span class="font-medium">{title}</span>
		{body}
	</Alert>
</div>
