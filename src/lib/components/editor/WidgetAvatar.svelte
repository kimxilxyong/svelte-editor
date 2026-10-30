<script lang="ts">
	/**
	 * @component WidgetAvatar
	 * Flowbite `Avatar` with initials derived from the title, next to name and caption.
	 *
	 * @prop {string} title - Person or account name (initials are derived from it).
	 * @prop {string} body - Caption below the name.
	 */
	import { Avatar } from 'flowbite-svelte';

	let { title, body }: { title: string; body: string } = $props();
	const initials = $derived(
		title
			.split(' ')
			.map((part) => part[0] ?? '')
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="flex h-full w-full flex-row items-center gap-2 overflow-hidden">
	<Avatar size="sm">{initials}</Avatar>
	<div class="min-w-0">
		<p class="truncate text-sm font-semibold">{title}</p>
		<p class="truncate text-xs opacity-70">{body}</p>
	</div>
</div>
