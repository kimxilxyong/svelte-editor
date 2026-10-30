<script lang="ts">
	/**
	 * @component WidgetBadge
	 * Flowbite `Badge` showing a compact status label plus a caption.
	 *
	 * @prop {string} title - Badge text.
	 * @prop {string} body - Tooltip text.
	 */
	import { Badge } from 'flowbite-svelte';

	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Badge title={body}>{title}</Badge>
</div>
