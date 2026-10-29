<script lang="ts">
	/**
	 * @component Features
	 * Feature showcase section highlighting key benefits and value propositions.
	 *
	 * @prop {string} title - Feature section title.
	 * @prop {string} body - Introductory subtitle or summary.
	 * @prop {'light'|'lavender'|'dark'} [theme='light'] - Visual color theme.
	 */
	let {
		title,
		body,
		theme = 'light'
	}: { title: string; body: string; theme?: 'light' | 'lavender' | 'dark' } = $props();
</script>

<section class="features-preview theme-{theme}">
	<span class="preview-kicker">MADE WITH INTENTION</span>
	<h2>{title}</h2>
	<p>{body}</p>
	<div class="feature-cards" aria-hidden="true">
		<div>
			<span>✧</span><strong>Thoughtful by design</strong><small>Every detail has a purpose.</small>
		</div>
		<div>
			<span>↗</span><strong>Room to grow</strong><small>Built around your next step.</small>
		</div>
		<div><span>♡</span><strong>People first</strong><small>Good work, together.</small></div>
	</div>
</section>

<style>
	.features-preview {
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

	.feature-cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 1.5rem;
	}
	.feature-cards > div {
		display: grid;
		min-height: 95px;
		align-content: start;
		gap: 0.35rem;
		padding: 0.8rem;
		border: 1px solid #eeeef2;
		border-radius: 8px;
		background: #fdfdfe;
	}
	.feature-cards span {
		color: #8072dc;
		font-size: 0.9rem;
	}
	.feature-cards strong {
		font-size: 0.62rem;
		font-weight: 680;
	}
	.feature-cards small {
		color: #8d8e9e;
		font-size: 0.55rem;
	}
	@media (max-width: 700px) {
		.features-preview {
			padding: 1.5rem 1.2rem;
		}
		.feature-cards {
			gap: 0.35rem;
		}
		.feature-cards > div {
			min-height: 90px;
			padding: 0.55rem;
		}
		.feature-cards strong {
			font-size: 0.56rem;
		}
		.feature-cards small {
			font-size: 0.5rem;
		}
	}
</style>
