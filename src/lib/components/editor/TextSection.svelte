<script lang="ts">
	/**
	 * @component TextSection
	 * Rich storytelling text section with header kicker and body copy.
	 *
	 * @prop {string} title - Section title heading.
	 * @prop {string} body - Narrative paragraph content.
	 * @prop {'light'|'lavender'|'dark'} [theme='light'] - Visual color theme.
	 */
	let {
		title,
		body,
		theme = 'light'
	}: { title: string; body: string; theme?: 'light' | 'lavender' | 'dark' } = $props();
</script>

<section class="text-preview theme-{theme}">
	<span class="preview-kicker">OUR STORY</span>
	<h2>{title}</h2>
	<p>{body}</p>
</section>

<style>
	.text-preview {
		width: 100%;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		padding: clamp(1.8rem, 5vw, 3.2rem);
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

	.theme-lavender {
		background: #f5f2ff;
	}

	.theme-light {
		background: #fff;
	}

	.theme-dark {
		background: #29273d;
		color: #fff;
	}

	.theme-dark h2 {
		color: #fff;
	}

	.theme-dark p {
		color: #c6c3d6;
	}

	@media (max-width: 700px) {
		.text-preview {
			padding: 1.5rem 1.2rem;
		}
	}
</style>
