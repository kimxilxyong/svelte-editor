<script lang="ts">
	const generatedId = $props.id();
	let {
		id = '',
		title,
		body,
		level = $bindable(0),
		onchange
	}: { id?: string; title: string; body: string; level?: number; onchange?: () => void } = $props();
	let inputId = $derived(id || generatedId);
</script>

<div class="widget-preview widget-form">
	<div class="widget-slider-heading">
		<label for={inputId}>{title}</label><output for={inputId}>{level}%</output>
	</div>
	<input
		id={inputId}
		class="widget-range"
		type="range"
		min="0"
		max="100"
		bind:value={level}
		oninput={() => onchange?.()}
	/>
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
	.widget-form {
		align-items: stretch;
	}
	.widget-slider-heading label {
		color: #4a4b60;
		font-size: 0.72rem;
		font-weight: 650;
	}
	.widget-slider-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.widget-slider-heading output {
		color: #77798c;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}
	.widget-form input.widget-range {
		width: 100%;
		accent-color: #6b5ce7;
	}
</style>
