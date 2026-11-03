<script lang="ts">
	/**
	 * @component WidgetBadge
	 * Flowbite `Badge` showing a compact status label plus a caption.
	 *
	 * @prop {string} title - Badge text.
	 * @prop {string} body - Tooltip text.
	 * @prop {string} [image=''] - Optional icon URL shown inside the badge.
	 */
	import { Badge } from 'flowbite-svelte';

	let { title, body, image = '' }: { title: string; body: string; image?: string } = $props();
	const safeImage = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(image)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Badge title={body}>
		{#if safeImage}
			<img src={image} alt="" class="mr-1 h-3.5 w-3.5 shrink-0 object-contain" />
		{/if}
		{title}
	</Badge>
</div>
