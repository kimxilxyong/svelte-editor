<script lang="ts">
	/**
	 * @component WidgetDropdown
	 * A Flowbite `Button` that opens a `Dropdown` menu.
	 *
	 * Link clicks are reported through `onnavigate` so the editor can block them; exported pages
	 * follow the per-entry link normally.
	 *
	 * @prop {string} [action] - Button label.
	 * @prop {string} [items] - Menu entries, one per line as `Label | /link` (link optional).
	 * @prop {(event: MouseEvent) => void} [onnavigate] - Reports entry clicks to the host.
	 */
	import { Button, Dropdown, DropdownItem } from 'flowbite-svelte';

	let {
		action = 'Menu',
		items = '',
		onnavigate
	}: { action?: string; items?: string; onnavigate?: (event: MouseEvent) => void } = $props();
	const safe = (href: string) =>
		/^https?:\/\/[^\s]+$/i.test(href) || /^\/(?!\/)[a-z0-9\-_/#?=&.]*$/i.test(href);
	const entries = $derived(
		(items || 'Dashboard\nSettings\nSign out')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [label, link = ''] = line.split('|').map((cell) => cell.trim());
				return { label, href: safe(link) ? link : undefined };
			})
	);
	let open = $state(false);
</script>

<div class="flex h-full w-full items-center overflow-visible">
	<Button size="sm">{action}</Button>
	<Dropdown simple bind:isOpen={open}>
		{#each entries as entry, index (index)}
			<DropdownItem href={entry.href} onclick={(event: MouseEvent) => onnavigate?.(event)}
				>{entry.label}</DropdownItem
			>
		{/each}
	</Dropdown>
</div>
