<script lang="ts">
	/**
	 * @component WidgetSidebar
	 * Flowbite `Sidebar` navigation list, rendered inline.
	 *
	 * Link clicks are reported through `onnavigate` so the editor can block them; exported pages
	 * follow the per-entry link normally.
	 * Local targets can contain percent-encoded characters, such as project image filenames.
	 *
	 * @prop {string} [items] - Entries, one per line as `Label | /link`. Defaults to Dashboard /
	 *   Inbox / Settings.
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports link clicks to the host.
	 */
	import { Sidebar, SidebarGroup, SidebarItem, SidebarWrapper } from 'flowbite-svelte';

	let { items = '', onnavigate }: { items?: string; onnavigate?: (event: MouseEvent) => void } =
		$props();
	const safe = (href: string) =>
		/^https?:\/\/[^\s]+$/i.test(href) || /^\/(?!\/)[a-z0-9\-_/#?=&.%]*$/i.test(href);
	const links = $derived(
		(items || 'Dashboard | /\nInbox | /inbox\nSettings | /settings')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [label, link = ''] = line.split('|').map((cell) => cell.trim());
				return { label, href: safe(link) ? link : undefined };
			})
	);
</script>

<div class="h-full w-full overflow-auto">
	<Sidebar alwaysOpen class="static h-full w-full" backdrop={false}>
		<SidebarWrapper class="h-full">
			<SidebarGroup>
				{#each links as link, index (index)}
					<SidebarItem
						label={link.label}
						href={link.href}
						onclick={(event: MouseEvent) => onnavigate?.(event)}
					/>
				{/each}
			</SidebarGroup>
		</SidebarWrapper>
	</Sidebar>
</div>
