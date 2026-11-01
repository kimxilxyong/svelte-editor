<script lang="ts">
	/**
	 * @component WidgetBreadcrumb
	 * Flowbite `Breadcrumb` trail.
	 *
	 * Link clicks are reported through `onnavigate` so the editor can block them; exported pages
	 * follow the per-entry link normally.
	 *
	 * @prop {string} [items] - Crumbs, one per line as `Label | /link` (link optional; only `https://`
	 *   and `/path` targets are used). Defaults to Home / Projects / Flowbite.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports crumb clicks to the host.
	 */
	import { Breadcrumb, BreadcrumbItem } from 'flowbite-svelte';

	let { items = '', onnavigate }: { items?: string; onnavigate?: (event: MouseEvent) => void } =
		$props();
	const safe = (href: string) =>
		/^https?:\/\/[^\s]+$/i.test(href) || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href);
	const crumbs = $derived(
		(items || 'Home | /\nProjects | /projects\nFlowbite')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [label, link = ''] = line.split('|').map((cell) => cell.trim());
				return { label, href: safe(link) ? link : undefined };
			})
	);
</script>

<div class="flex h-full w-full items-center overflow-hidden">
	<Breadcrumb>
		{#each crumbs as crumb, index (index)}
			<BreadcrumbItem
				home={index === 0}
				href={crumb.href}
				onclick={(event: MouseEvent) => onnavigate?.(event)}>{crumb.label}</BreadcrumbItem
			>
		{/each}
	</Breadcrumb>
</div>
