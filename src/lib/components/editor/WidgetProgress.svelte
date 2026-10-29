<script lang="ts">
	let {
		title,
		body,
		level = $bindable(0)
	}: { title: string; body: string; level?: number } = $props();
</script>

<div class="widget-preview widget-form">
	<div class="widget-slider-heading"><strong>{title}</strong><output>{level}%</output></div>
	<progress value={level} max="100" aria-label={title}></progress>
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
	.widget-form progress {
		width: 100%;
		height: 10px;
		accent-color: #6b5ce7;
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
</style>
