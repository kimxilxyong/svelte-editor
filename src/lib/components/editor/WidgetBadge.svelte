<script lang="ts">
	/**
	 * @component WidgetBadge
	 * Compact status pill or category badge widget.
	 *
	 * @prop {string} title - Badge pill label text.
	 * @prop {string} body - Supporting context caption.
	 */
	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="widget-preview widget-badge-preview">
	<span class="widget-badge">{title}</span>
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
	.widget-badge-preview {
		align-items: flex-start;
	}
	.widget-badge {
		display: inline-flex;
		min-height: 25px;
		align-items: center;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: #eeeaff;
		color: #5e50c8;
		font-size: 0.68rem;
		font-weight: 680;
	}
</style>
