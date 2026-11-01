<script lang="ts">
	/**
	 * @component WidgetAccordion
	 * Flowbite `Accordion` of collapsible sections.
	 *
	 * @prop {string} [items] - Sections, one per line as `Heading | Content`. Defaults to two samples.
	 */
	import { Accordion, AccordionItem } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const sections = $derived(
		(items || 'What is this? | A visual page builder.\nCan I export it? | Yes, as native Svelte.')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [heading, ...rest] = line.split('|');
				return { heading: heading.trim(), content: rest.join('|').trim() };
			})
	);
</script>

<div class="h-full w-full overflow-auto">
	<Accordion>
		{#each sections as section, index (index)}
			<AccordionItem open={index === 0}>
				{#snippet header()}{section.heading}{/snippet}
				<p class="text-sm opacity-80">{section.content}</p>
			</AccordionItem>
		{/each}
	</Accordion>
</div>
