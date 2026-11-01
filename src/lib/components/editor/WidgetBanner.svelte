<script lang="ts">
	/**
	 * @component WidgetBanner
	 * Flowbite `Banner`: a dismissible announcement strip.
	 *
	 * @prop {string} [title] - Bold lead-in.
	 * @prop {string} [body] - Announcement text.
	 */
	import { Banner } from 'flowbite-svelte';

	let { title = '', body = '' }: { title?: string; body?: string } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Banner class="static w-full" dismissable>
		<p class="text-sm">
			<strong>{title}</strong>
			{body}
		</p>
	</Banner>
</div>
