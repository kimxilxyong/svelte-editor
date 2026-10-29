<script lang="ts">
	/**
	 * @component WidgetButton
	 * Atomic button GUI widget providing an interactive action trigger.
	 *
	 * @prop {string} action - Button label text.
	 * @prop {string} body - Explanatory helper caption below button.
	 * @prop {() => void} [onchange] - Optional click/change event handler.
	 */
	let { action, body, onchange }: { action: string; body: string; onchange?: () => void } =
		$props();
</script>

<div class="widget-preview">
	<button class="widget-button" type="button" onclick={() => onchange?.()}
		>{action}<span aria-hidden="true">↗</span></button
	>
	<p>{body}</p>
</div>

<style>
	.widget-preview {
		width: 100%;
		height: 100%;
		min-height: 130px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.7rem;
		padding: 1.5rem;
		overflow: auto;
		background: #fff;
		color: #323449;
		font-size: 0.78rem;
	}
	.widget-preview p {
		margin: 0;
		color: #85869a;
		font-size: 0.68rem;
		line-height: 1.55;
	}
	.widget-button {
		display: inline-flex;
		min-height: 42px;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		align-self: flex-start;
		padding: 0.65rem 1rem;
		border: 0;
		border-radius: 8px;
		background: #6554d8;
		color: #fff;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 650;
		cursor: pointer;
	}
</style>
