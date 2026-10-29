<script lang="ts">
	/**
	 * @component WidgetLink
	 * Navigation link widget supporting internal page routing and external URLs.
	 *
	 * @prop {string} title - Anchor text.
	 * @prop {string} body - Accompanying caption.
	 * @prop {string} href - Target route or URL.
	 * @prop {boolean} newTab - Whether external links open in a new tab.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Intercept handler for preview mode routing.
	 */
	let {
		title,
		body,
		href,
		newTab,
		onnavigate
	}: {
		title: string;
		body: string;
		href: string;
		newTab: boolean;
		onnavigate?: (event: MouseEvent) => void;
	} = $props();
	let safeHref = $derived(/^\/[a-z0-9\-_/#?=&.]*$/.test(href) || /^https?:\/\//.test(href));
	let externalHref = $derived(/^https?:\/\//.test(href));
</script>

<div class="widget-preview widget-link-preview">
	<a
		class="widget-link"
		href={safeHref ? href : undefined}
		target={externalHref && newTab ? '_blank' : undefined}
		rel="noopener noreferrer"
		onclick={(event) => onnavigate?.(event)}
	>
		{title}<span aria-hidden="true">↪</span>
	</a>
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
	.widget-link-preview {
		gap: 0.25rem;
	}
	.widget-link {
		display: inline-flex;
		gap: 0.3rem;
		color: #1f6f5c;
		font-weight: 600;
		text-decoration: underline;
	}
	.widget-link-preview p {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.7;
	}
</style>
