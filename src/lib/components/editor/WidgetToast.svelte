<script lang="ts">
	/**
	 * @component WidgetToast
	 * Flowbite `Toast` notification, shown inline (not floating) so it can be placed on the canvas.
	 *
	 * @prop {string} [title] - Message heading.
	 * @prop {string} [body] - Message text.
	 * @prop {string} [image=''] - Optional icon URL shown inside the toast.
	 */
	import { Toast } from 'flowbite-svelte';

	let {
		title = '',
		body = '',
		image = ''
	}: { title?: string; body?: string; image?: string } = $props();
	const safeImage = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(image)
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Toast class="w-full max-w-none">
		<div class="flex items-center gap-2">
			{#if safeImage}
				<img src={image} alt="" class="h-5 w-5 shrink-0 object-contain" />
			{/if}
			<div>
				<div class="text-sm font-semibold">{title}</div>
				{#if body}<div class="text-sm font-normal opacity-80">{body}</div>{/if}
			</div>
		</div>
	</Toast>
</div>
