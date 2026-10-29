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

<section class="quote-preview theme-{theme}">
	<span class="quote-mark" aria-hidden="true">“</span>
	<h2>{title}</h2>
	<p>{body}</p>
	<span class="quote-author">{action}</span>
</section>

<style>
	.quote-preview {
		width: 100%;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: auto;
		display: grid;
		min-height: 180px;
		align-content: center;
		justify-items: center;
		padding: 2rem;
		background: #fbfaf8;
		text-align: center;
	}
	.quote-mark {
		height: 26px;
		color: #b3a5e8;
		font-family: Georgia, serif;
		font-size: 3rem;
		line-height: 1;
	}
	.quote-preview h2 {
		margin: 0.4rem 0;
		font-family: Georgia, serif;
		font-size: clamp(1.15rem, 2.3vw, 1.7rem);
		font-weight: 500;
		letter-spacing: -0.035em;
	}
	.quote-preview p {
		max-width: 440px;
		margin: 0 auto;
		color: #7e7d89;
		font-size: 0.7rem;
		line-height: 1.6;
	}
	.quote-author {
		margin-top: 0.75rem;
		color: #858494;
		font-size: 0.6rem;
		font-weight: 650;
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
</style>
