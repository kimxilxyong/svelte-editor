<script lang="ts">
	let {
		title,
		body,
		theme = 'light'
	}: { title: string; body: string; theme?: 'light' | 'lavender' | 'dark' } = $props();
</script>

<section class="image-preview theme-{theme}">
	<div class="image-art" aria-hidden="true">
		<div class="sun"></div>
		<div class="hill hill-back"></div>
		<div class="hill hill-front"></div>
		<span>✳</span>
	</div>
	<div>
		<span class="preview-kicker">A FRESH PERSPECTIVE</span>
		<h2>{title}</h2>
		<p>{body}</p>
	</div>
</section>

<style>
	.image-preview {
		width: 100%;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: center;
		gap: 1.8rem;
		padding: clamp(1.3rem, 4vw, 2.5rem);
		background: #f7f4ff;
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

	.image-art {
		position: relative;
		min-height: 145px;
		overflow: hidden;
		border-radius: 8px;
		background: linear-gradient(150deg, #dbd3fa, #efe4e7 65%, #f2d5bd);
	}
	.sun {
		position: absolute;
		top: 18%;
		right: 22%;
		width: 35px;
		height: 35px;
		border-radius: 50%;
		background: #ffd59b;
		box-shadow: 0 0 30px rgb(255 213 155 / 60%);
	}
	.hill {
		position: absolute;
		right: -10%;
		bottom: -48%;
		width: 120%;
		height: 100%;
		transform: rotate(-12deg);
		border-radius: 50% 50% 0 0;
		background: #a59bd7;
	}
	.hill-back {
		right: 32%;
		bottom: -55%;
		background: #c5b7df;
	}
	.hill-front {
		bottom: -70%;
		background: #7772b4;
	}
	.image-art > span {
		position: absolute;
		top: 20%;
		left: 18%;
		color: white;
		font-size: 1rem;
	}
	.image-preview h2 {
		margin-bottom: 0.5rem;
	}
	@media (max-width: 700px) {
		.image-preview {
			grid-template-columns: 1fr;
			gap: 1rem;
			padding: 1.1rem;
		}
		.image-art {
			min-height: 120px;
		}
	}
</style>
