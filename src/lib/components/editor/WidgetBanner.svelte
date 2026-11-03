<script lang="ts">
	/**
	 * @component WidgetBanner
	 * Flowbite `Banner`: a dismissible announcement strip.
	 *
	 * @prop {string} [title] - Bold lead-in.
	 * @prop {string} [body] - Announcement text.
	 * @prop {string} [image=''] - Optional icon URL shown before the announcement text.
	 */
	import { Banner } from 'flowbite-svelte';

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
	<Banner class="static w-full" dismissable>
		<p class="flex items-center gap-2 text-sm">
			{#if safeImage}
				<img src={image} alt="" class="h-4 w-4 shrink-0 object-contain" />
			{/if}
			<span>
				<strong>{title}</strong>
				{body}
			</span>
		</p>
	</Banner>
</div>
