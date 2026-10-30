<script lang="ts">
	/**
	 * @component WidgetSlider
	 * Flowbite `Range` slider (0–100) with a live percentage readout.
	 *
	 * @prop {string} [id] - Block id, used to link label and input.
	 * @prop {string} title - Label text.
	 * @prop {string} body - Helper text.
	 * @prop {number} [level] - `$bindable()` value from 0 to 100.
	 * @prop {() => void} [onchange] - Called while the user drags.
	 */
	import { Range, Label, Helper } from 'flowbite-svelte';

	let {
		id = '',
		title,
		body,
		level = $bindable(0),
		onchange
	}: { id?: string; title: string; body: string; level?: number; onchange?: () => void } = $props();
	const inputId = $derived(`slider-${id}`);
</script>

<div class="flex h-full w-full flex-col justify-center gap-2 overflow-hidden">
	<div class="flex items-center justify-between">
		<Label for={inputId} class="text-sm">{title}</Label><output
			class="text-sm font-medium text-gray-700">{level}%</output
		>
	</div>
	<Range id={inputId} min={0} max={100} bind:value={level} oninput={() => onchange?.()} />
	{#if body}<Helper>{body}</Helper>{/if}
</div>
