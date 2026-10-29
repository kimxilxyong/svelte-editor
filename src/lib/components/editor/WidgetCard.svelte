<script lang="ts">
	let {
		title,
		body,
		action,
		onchange
	}: { title: string; body: string; action: string; onchange?: () => void } = $props();
</script>

<div class="widget-preview widget-card-preview">
	<span class="widget-card-mark" aria-hidden="true">✦</span>
	<h2>{title}</h2>
	<p>{body}</p>
	<button type="button" onclick={() => onchange?.()}
		>{action} <span aria-hidden="true">↗</span></button
	>
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
	.widget-card-preview {
		align-items: flex-start;
		border: 1px solid #e8e8ef;
		border-radius: 10px;
		box-shadow: 0 5px 16px rgb(34 34 56 / 0.07);
	}
	.widget-card-mark {
		color: #7667dd;
		font-size: 1.2rem;
	}
	.widget-card-preview h2 {
		margin: 0;
		color: #36384d;
		font-size: 0.95rem;
		font-weight: 700;
	}
	.widget-card-preview button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: #6253ca;
		font: inherit;
		font-size: 0.7rem;
		font-weight: 650;
		cursor: pointer;
	}
</style>
