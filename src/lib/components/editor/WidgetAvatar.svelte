<script lang="ts">
	let { title, body }: { title: string; body: string } = $props();
</script>

<div class="widget-preview widget-avatar-preview">
	<span class="widget-avatar" aria-hidden="true"
		>{title
			.split(' ')
			.map((part) => part[0] ?? '')
			.slice(0, 2)
			.join('')
			.toUpperCase()}</span
	>
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
	.widget-avatar-preview {
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
	}
	.widget-avatar-preview strong {
		color: #43455a;
		font-size: 0.76rem;
		font-weight: 650;
	}
	.widget-avatar {
		display: grid;
		width: 54px;
		height: 54px;
		flex: 0 0 54px;
		place-items: center;
		border-radius: 50%;
		background: linear-gradient(135deg, #dcd5ff, #a89af2);
		color: #453b96;
		font-size: 0.95rem;
		font-weight: 750;
	}
</style>
