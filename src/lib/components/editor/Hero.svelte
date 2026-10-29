<script lang="ts">
	/**
	 * @component Hero
	 * Bold opening section for a landing page or website header.
	 *
	 * @prop {string} title - Main headline text.
	 * @prop {string} body - Supporting descriptive text.
	 * @prop {string} action - Call-to-action button caption.
	 * @prop {'light'|'lavender'|'dark'} [theme='light'] - Visual color theme.
	 */
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

<section class="hero-preview theme-{theme}">
	<span class="preview-kicker">A LITTLE MORE YOU</span>
	<h2>{title}</h2>
	<p>{body}</p>
	{#if action}<span class="mock-cta">{action}<span aria-hidden="true"> ↗</span></span>{/if}
	<div class="hero-orbit" aria-hidden="true"><span>✳</span><i></i></div>
</section>

<style>
	.hero-preview {
		width: 100%;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		position: relative;
		min-height: 290px;
		padding: clamp(2rem, 6vw, 4.2rem);
		background: linear-gradient(115deg, #f3efff 0%, #f5f2ff 52%, #e8e4ff 100%);
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
		font-size: clamp(1.45rem, 3vw, 2.45rem);
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

	.theme-lavender {
		background: linear-gradient(115deg, #f3efff 0%, #f5f2ff 52%, #e8e4ff 100%);
	}
	.theme-light {
		background: linear-gradient(115deg, #fff 0%, #fbfbfd 58%, #f3f2f7 100%);
	}
	.theme-dark {
		background: linear-gradient(115deg, #29273d 0%, #34314e 58%, #464064 100%);
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
		background: #6554d8;
		color: white;
		font-size: 0.68rem;
		font-weight: 650;
	}
	.hero-orbit {
		position: absolute;
		right: 8%;
		bottom: 5%;
		display: grid;
		width: 140px;
		height: 140px;
		place-items: center;
		border: 1px solid rgb(126 110 221 / 0.2);
		border-radius: 50%;
		color: #9586e7;
		font-size: 3rem;
	}
	.hero-orbit::before,
	.hero-orbit::after {
		position: absolute;
		inset: 13px;
		border: 1px solid rgb(126 110 221 / 0.15);
		border-radius: 50%;
		content: '';
	}
	.hero-orbit::after {
		inset: 30px;
	}
	.hero-orbit i {
		position: absolute;
		top: 13px;
		right: 25px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #e1a782;
	}
	@media (max-width: 700px) {
		.hero-preview {
			min-height: 250px;
			padding: 2rem 1.3rem;
		}
		.hero-orbit {
			right: -38px;
			bottom: -38px;
			width: 110px;
			height: 110px;
		}
	}
</style>
