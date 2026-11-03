<script lang="ts">
	/**
	 * @component WidgetFooter
	 * Flowbite `Footer` with a copyright line and a link group.
	 *
	 * Link clicks are reported through `onnavigate` so the editor can block them; exported pages
	 * follow the per-entry link normally.
	 * Local targets can contain percent-encoded characters, such as project image filenames.
	 *
	 * @prop {string} [title] - Owner shown in the copyright line.
	 * @prop {string} [items] - Links, one per line as `Label | /link`. Defaults to About / Privacy.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports link clicks to the host.
	 */
	import { Footer, FooterCopyright, FooterLinkGroup, FooterLink } from 'flowbite-svelte';

	let {
		title = '',
		items = '',
		onnavigate
	}: { title?: string; items?: string; onnavigate?: (event: MouseEvent) => void } = $props();
	const safe = (href: string) =>
		/^https?:\/\/[^\s]+$/i.test(href) || /^\/(?!\/)[a-z0-9\-_/#?=&.%]*$/i.test(href);
	const links = $derived(
		(items || 'About | /about\nPrivacy | /privacy\nContact | /contact')
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
	<Footer class="w-full">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<FooterCopyright href={undefined} by={title} />
			<FooterLinkGroup class="flex flex-wrap items-center gap-4 text-sm">
				{#each links as link, index (index)}
					<FooterLink href={link.href} onclick={(event: MouseEvent) => onnavigate?.(event)}
						>{link.label}</FooterLink
					>
				{/each}
			</FooterLinkGroup>
		</div>
	</Footer>
</div>
