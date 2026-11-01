<script lang="ts">
	/**
	 * @component WidgetTimeline
	 * Flowbite `Timeline` of dated events.
	 *
	 * @prop {string} [items] - Events, one per line as `Date | Title | Text`. Defaults to two samples.
	 */
	import { Timeline, TimelineItem } from 'flowbite-svelte';

	let { items = '' }: { items?: string } = $props();
	const events = $derived(
		(
			items ||
			'January 2025 | Launch | The first version went live.\nMarch 2025 | Growth | We reached 1,000 users.'
		)
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [date, title = '', ...rest] = line.split('|');
				return { date: date.trim(), title: title.trim(), text: rest.join('|').trim() };
			})
	);
</script>

<div class="h-full w-full overflow-auto px-2 pt-1">
	<Timeline>
		{#each events as event, index (index)}
			<TimelineItem title={event.title} date={event.date}>
				<p class="text-sm opacity-80">{event.text}</p>
			</TimelineItem>
		{/each}
	</Timeline>
</div>
