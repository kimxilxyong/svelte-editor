<script lang="ts">
	/**
	 * @component WidgetAvatar
	 * Flowbite `Avatar` with an optional image or initials derived from the title, next to name and caption.
	 *
	 * @prop {string} title - Person or account name (initials are derived from it).
	 * @prop {string} body - Caption below the name.
	 * @prop {string} [image=''] - Optional avatar image URL.
	 */
	import { Avatar } from 'flowbite-svelte';

	let { title, body, image = '' }: { title: string; body: string; image?: string } = $props();
	const initials = $derived(
		title
			.split(' ')
			.map((part) => part[0] ?? '')
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
	const safeImage = $derived(
		/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*|data:image\/[a-z+.-]+[;,][^\s]*)$/i.test(image)
	);
</script>

<div class="flex h-full w-full flex-row items-center gap-2 overflow-hidden">
	{#if safeImage}
		<Avatar size="sm" src={image} />
	{:else}
		<Avatar size="sm">{initials}</Avatar>
	{/if}
	<div class="min-w-0">
		<p class="truncate text-sm font-semibold">{title}</p>
		<p class="truncate text-xs opacity-70">{body}</p>
	</div>
</div>
