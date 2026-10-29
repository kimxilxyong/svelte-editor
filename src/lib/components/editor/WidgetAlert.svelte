<script lang="ts">
	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="widget-preview widget-alert-preview" role="status">
	<span class="alert-icon" aria-hidden="true">✓</span>
	<div>
		<strong>{title}</strong>
		<p>{body}</p>
	</div>
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
	.widget-alert-preview {
		flex-direction: row;
		align-items: flex-start;
		justify-content: flex-start;
		border: 1px solid #cde9d9;
		border-radius: 9px;
		background: #f2fbf5;
	}
	.alert-icon {
		display: grid;
		width: 24px;
		height: 24px;
		flex: 0 0 24px;
		place-items: center;
		border-radius: 50%;
		background: #d8f1e2;
		color: #27794b;
		font-weight: 700;
	}
	.widget-alert-preview strong {
		color: #315d43;
		font-size: 0.75rem;
	}
</style>
