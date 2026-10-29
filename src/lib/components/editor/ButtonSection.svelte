<script lang="ts">
	let {
		title,
		body,
		action,
		theme = 'light'
	}: {
		title: string;
		body: string;
		action: string;
		theme?: 'light' | 'lavender' | 'dark';
	} = $props();
</script>

<section class="button-preview theme-{theme}">
	<div>
		<span class="preview-kicker">YOUR NEXT CHAPTER</span>
		<h2>{title}</h2>
		<p>{body}</p>
	</div>
	<span class="mock-cta">{action}<span aria-hidden="true"> ↗</span></span>
</section>

<style>
	.button-preview {
		width: 100%;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 2rem clamp(1.8rem, 5vw, 3.2rem);
		background: #27263c;
		color: white;
	}

	.preview-kicker {
		display: block;
		margin-bottom: 0.8rem;
		color: #8174c6;
		font-size: 0.55rem;
		font-weight: 750;
		letter-spacing: 0.14em;
	}

	h2 {
		position: relative;
		z-index: 1;
		max-width: 500px;
		margin: 0 0 0.75rem;
		font-size: clamp(1.2rem, 2.5vw, 1.8rem);
		font-weight: 690;
		letter-spacing: -0.055em;
		line-height: 1.08;
	}

	p {
		position: relative;
		z-index: 1;
		max-width: 400px;
		margin: 0;
		color: #73748b;
		font-size: 0.8rem;
		line-height: 1.65;
	}

	.button-preview .preview-kicker {
		color: #b1a7ef;
	}
	.button-preview h2 {
		margin-bottom: 0.45rem;
		color: white;
	}
	.button-preview p {
		color: #c3c0d0;
	}
	.mock-cta {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.65rem;
		margin-top: 1.25rem;
		padding: 0.7rem 0.95rem;
		border-radius: 7px;
		background: white;
		color: #39344e;
		font-size: 0.68rem;
		font-weight: 650;
		flex-shrink: 0;
	}
	@media (max-width: 700px) {
		.button-preview {
			align-items: flex-start;
			flex-direction: column;
			padding: 1.5rem 1.2rem;
		}
		.mock-cta {
			margin-top: 0.1rem;
		}
	}
</style>
