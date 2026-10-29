<script lang="ts">
	/**
	 * @component CanvasSizePicker
	 *
	 * Compact picker for the canvas size of a page: a grouped list of common resolutions
	 * (Desktop / Tablet / Mobile) plus a "Custom" entry, and a button that swaps width and
	 * height (portrait ↔ landscape). Sizes that match no preset are shown as "Custom".
	 *
	 * @prop {number} width - Canvas width in px. `$bindable()`.
	 * @prop {number} height - Canvas minimum height in px. `$bindable()`.
	 * @prop {() => void} [onchange] - Called after the user changed the size via this control.
	 * @prop {string} [id] - Optional id for the `<select>` so an external `<label for>` can target it.
	 *
	 * @example
	 * <CanvasSizePicker bind:width={page.width} bind:height={page.height} onchange={markUnsaved} />
	 */
	import { canvasLimits, canvasPresets, findCanvasPreset, type CanvasPreset } from '../editor.js';

	let {
		width = $bindable(),
		height = $bindable(),
		onchange,
		id
	}: { width: number; height: number; onchange?: () => void; id?: string } = $props();

	const groups: CanvasPreset['group'][] = ['Desktop', 'Tablet', 'Mobile'];
	const matched = $derived(findCanvasPreset(width, height));
	const selectValue = $derived(matched ? `${matched.width}x${matched.height}` : 'custom');
	const canSwap = $derived(
		width !== height &&
			height >= canvasLimits.minWidth &&
			height <= canvasLimits.maxWidth &&
			width >= canvasLimits.minHeight &&
			width <= canvasLimits.maxHeight
	);

	function choose(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'custom') return;
		const [nextWidth, nextHeight] = value.split('x').map(Number);
		width = nextWidth;
		height = nextHeight;
		onchange?.();
	}

	function swap() {
		if (!canSwap) return;
		[width, height] = [height, width];
		onchange?.();
	}
</script>

<div class="canvas-size-picker">
	<select {id} aria-label="Canvas size" value={selectValue} onchange={choose}>
		{#each groups as group (group)}
			<optgroup label={group}>
				{#each canvasPresets.filter((preset) => preset.group === group) as preset (preset.label)}
					<option value="{preset.width}x{preset.height}">
						{preset.label} — {preset.width} × {preset.height}
					</option>
				{/each}
			</optgroup>
		{/each}
		<option value="custom" disabled={!!matched}>Custom — {width} × {height}</option>
	</select>
	<button
		type="button"
		class="swap"
		aria-label="Swap width and height"
		title="Swap width and height (rotate)"
		disabled={!canSwap}
		onclick={swap}
	>
		⇄
	</button>
</div>

<style>
	.canvas-size-picker {
		display: flex;
		min-width: 0;
		gap: 0.3rem;
		align-items: center;
	}

	select {
		min-width: 0;
		max-width: 100%;
		flex: 1;
		min-height: 34px;
		padding: 0 0.5rem;
		border: 1px solid #d9d9e3;
		border-radius: 8px;
		background: #fff;
		color: #222238;
		font: inherit;
		font-size: 0.82rem;
	}

	.swap {
		min-width: 34px;
		min-height: 34px;
		padding: 0;
		border: 1px solid #d9d9e3;
		border-radius: 8px;
		background: #fff;
		color: #222238;
		cursor: pointer;
	}

	.swap:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	select:focus-visible,
	.swap:focus-visible {
		outline: 2px solid #6d5dfc;
		outline-offset: 1px;
	}
</style>
