<script lang="ts">
	/**
	 * @component WidgetClipboard
	 * Flowbite `Clipboard` button that copies text and confirms with a check mark.
	 *
	 * @prop {string} [title] - Label above the field.
	 * @prop {string} [body] - The text that is copied (shown in a read-only field).
	 */
	import { Clipboard, Input, Label, ButtonGroup } from 'flowbite-svelte';

	let { title = '', body = '' }: { title?: string; body?: string } = $props();
</script>

<div class="flex h-full w-full flex-col justify-center gap-2">
	<Label class="text-sm">{title}</Label>
	<ButtonGroup class="w-full">
		<Input readonly value={body} />
		<Clipboard value={body} color="alternative">
			{#snippet children(success)}{success ? 'Copied' : 'Copy'}{/snippet}
		</Clipboard>
	</ButtonGroup>
</div>
