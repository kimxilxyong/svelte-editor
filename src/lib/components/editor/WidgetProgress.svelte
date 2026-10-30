<script lang="ts">
	/**
	 * @component WidgetProgress
	 * Flowbite `Progressbar` showing completion.
	 *
	 * @prop {string} title - Label text.
	 * @prop {string} body - Helper text.
	 * @prop {number} [level] - Completion percentage 0–100.
	 */
	import { Progressbar, Helper } from 'flowbite-svelte';

	let { title, body, level = 0 }: { title: string; body: string; level?: number } = $props();
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<div class="flex items-center justify-between text-xs font-medium">
		<span>{title}</span><output>{level}%</output>
	</div>
	<Progressbar progress={level} size="h-2" animate={false} />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
