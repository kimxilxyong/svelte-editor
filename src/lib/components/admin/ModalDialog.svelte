<script lang="ts">
	/**
	 * @component ModalDialog
	 *
	 * Accessible modal built on the native `<dialog>` element.
	 *
	 * ## Why native `<dialog>`
	 * `showModal()` gives us, for free and correctly: a focus trap, `inert` background, `Esc` to
	 * close, top-layer rendering and focus restoration to the element that opened the dialog.
	 * The component only mirrors the bindable `open` flag onto the element.
	 *
	 * ## Lifecycle
	 * The body is rendered only while `open` is true, so every opening starts with fresh form
	 * state and nothing (for example a typed password) lingers in the DOM afterwards.
	 *
	 * @prop {boolean} [open=false] - Bindable. Set to `true` to show; reset to `false` on close
	 *   (including `Esc` and backdrop click).
	 * @prop {string} title - Visible heading; also the accessible name of the dialog.
	 * @prop {string} [description] - Optional sentence below the heading (`aria-describedby`).
	 * @prop {() => void} [onclose] - Called after the dialog was closed.
	 * @prop {import('svelte').Snippet} children - Dialog body (usually a form).
	 *
	 * @example
	 * <ModalDialog bind:open={showCreate} title="New user"> <form>…</form> </ModalDialog>
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		onclose?: () => void;
		children: Snippet;
	}

	let { open = $bindable(false), title, description, onclose, children }: Props = $props();

	const uid = $props.id();

	/**
	 * Attachment: one-way sync state → element (re-runs whenever `open` changes). The reverse
	 * direction is the native `close` event handler on the element below.
	 */
	function syncOpen(node: HTMLDialogElement) {
		if (open && !node.open) node.showModal();
		else if (!open && node.open) node.close();
	}

	/** Closes when the backdrop (the dialog element itself, outside its box) is clicked. */
	function onBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) (event.currentTarget as HTMLDialogElement).close();
	}
</script>

<!-- Keyboard users close with Esc (native); the backdrop click is a pointer-only convenience. -->
<dialog
	{@attach syncOpen}
	class="modal"
	aria-labelledby="{uid}-title"
	aria-describedby={description ? `${uid}-desc` : undefined}
	onclick={onBackdropClick}
	onclose={() => {
		open = false;
		onclose?.();
	}}
>
	{#if open}
		<div class="modal-body">
			<h2 id="{uid}-title">{title}</h2>
			{#if description}<p id="{uid}-desc" class="modal-desc">{description}</p>{/if}
			{@render children()}
		</div>
	{/if}
</dialog>

<style>
	.modal {
		width: min(32rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		margin: auto;
		padding: 0;
		overflow: auto;
		border: 1px solid #e9e9f0;
		border-radius: 12px;
		background: #fff;
		color: #20233a;
		box-shadow: 0 24px 60px rgb(32 35 58 / 25%);
	}

	.modal::backdrop {
		background: rgb(32 35 58 / 45%);
	}

	.modal-body {
		padding: 1.2rem 1.3rem 1.3rem;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.modal-desc {
		margin: 0.4rem 0 0;
		color: #686a80;
		font-size: 0.78rem;
	}
</style>
