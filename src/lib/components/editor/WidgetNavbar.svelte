<script lang="ts">
	/**
	 * @component WidgetNavbar
	 * Flowbite `Navbar` with a brand and navigation links.
	 *
	 * Link clicks are reported through `onnavigate` so the editor can block them; exported pages
	 * follow the per-entry link normally.
	 *
	 * @prop {string} [title] - Brand name.
	 * @prop {string} [items] - Links, one per line as `Label | /link` (only `https://` and `/path`
	 *   targets are used). Defaults to Home / About / Contact.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports link clicks to the host.
	 */
	import { Navbar, NavBrand, NavUl, NavLi, NavHamburger } from 'flowbite-svelte';

	let {
		title = '',
		items = '',
		onnavigate
	}: { title?: string; items?: string; onnavigate?: (event: MouseEvent) => void } = $props();
	const safe = (href: string) =>
		/^https?:\/\/[^\s]+$/i.test(href) || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href);
	const links = $derived(
		(items || 'Home | /\nAbout | /about\nContact | /contact')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [label, link = ''] = line.split('|').map((cell) => cell.trim());
				return { label, href: safe(link) ? link : undefined };
			})
	);
</script>

<div class="h-full w-full overflow-visible">
	<Navbar class="w-full">
		<NavBrand href={undefined}><span class="text-lg font-semibold">{title}</span></NavBrand>
		<NavHamburger />
		<NavUl>
			{#each links as link, index (index)}
				<NavLi href={link.href} onclick={(event: MouseEvent) => onnavigate?.(event)}
					>{link.label}</NavLi
				>
			{/each}
		</NavUl>
	</Navbar>
</div>
