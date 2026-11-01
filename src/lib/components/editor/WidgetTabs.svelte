<script lang="ts">
	/**
	 * @component WidgetTabs
	 * Flowbite `Tabs` with one panel per tab.
	 *
	 * @prop {string} [items] - Tabs, one per line as `Tab title | Panel text`. Defaults to three samples.
	 */
	import { Tabs, TabItem } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const tabs = $derived(
		(
			items ||
			'Profile | Your profile details.\nSettings | Your preferences.\nContacts | Your contacts.'
		)
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [title, ...rest] = line.split('|');
				return { title: title.trim(), content: rest.join('|').trim() };
			})
	);
</script>

<div class="h-full w-full overflow-auto">
	<Tabs tabStyle="underline">
		{#each tabs as tab, index (index)}
			<TabItem open={index === 0} title={tab.title}>
				<p class="text-sm opacity-80">{tab.content}</p>
			</TabItem>
		{/each}
	</Tabs>
</div>
