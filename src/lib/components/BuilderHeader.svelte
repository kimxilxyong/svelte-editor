<script lang="ts">
	/**
	 * @component BuilderHeader
	 *
	 * The "PAGE BUILDER" bar shown directly below {@link AppNav} on both builder routes
	 * (`/` and `/editor`). Having one component guarantees both routes look and flow the same.
	 *
	 * Layout (always a single left→right row; it only wraps on very narrow screens):
	 * - Left: brand mark, "PAGE BUILDER" eyebrow, site title and the save status indicator.
	 * - Right: **Save**, **Undo**, **Redo**, **Preview** – nothing else.
	 *
	 * Buttons whose callback is not supplied (for example Undo on the page list, which has no
	 * edit history) are still rendered, but disabled, so the bar keeps an identical shape.
	 *
	 * @prop {string} status - Human readable save status text (announced politely to screen readers).
	 * @prop {boolean} [busy=false] - A database request is running; disables Save and sets `aria-busy`.
	 * @prop {boolean} [unsaved=false] - Show the amber "unsaved changes" dot instead of the green one.
	 * @prop {boolean} [canSave=true] - Whether Save is currently allowed.
	 * @prop {boolean} [canUndo=false] - Whether Undo is currently allowed.
	 * @prop {boolean} [canRedo=false] - Whether Redo is currently allowed.
	 * @prop {boolean} [previewing=false] - Preview mode is on; the button then reads "Back to editor".
	 * @prop {string} [eyebrow='PAGE BUILDER'] - Small caps label above the title (the component editor uses 'COMPONENT EDITOR').
	 * @prop {string} [title='Untitled website'] - Site title shown next to the eyebrow.
	 * @prop {string} [saveLabel='Save'] - Text of the save button.
	 * @prop {string} [readOnlyNotice] - When set, the viewer may not save (e.g. role `guest`): Save is disabled and the text is shown as a tooltip and a small visible "Read-only" badge next to it.
	 * @prop {() => void} [onsave] - Save clicked.
	 * @prop {() => void} [onundo] - Undo clicked. When omitted the button is disabled.
	 * @prop {() => void} [onredo] - Redo clicked. When omitted the button is disabled.
	 * @prop {() => void} [onpreview] - Preview clicked. When omitted the button is disabled.
	 *
	 * @example
	 * <BuilderHeader {status} {busy} {unsaved} canSave={dirty} onsave={save} />
	 */
	let {
		status,
		busy = false,
		unsaved = false,
		canSave = true,
		canUndo = false,
		canRedo = false,
		previewing = false,
		eyebrow = 'PAGE BUILDER',
		title = 'Untitled website',
		saveLabel = 'Save',
		readOnlyNotice,
		onsave,
		onundo,
		onredo,
		onpreview
	}: {
		status: string;
		busy?: boolean;
		unsaved?: boolean;
		canSave?: boolean;
		canUndo?: boolean;
		canRedo?: boolean;
		previewing?: boolean;
		eyebrow?: string;
		title?: string;
		saveLabel?: string;
		readOnlyNotice?: string;
		onsave?: () => void;
		onundo?: () => void;
		onredo?: () => void;
		onpreview?: () => void;
	} = $props();
</script>

<header class="builder-header">
	<div class="project-name">
		<div class="brand-mark" aria-hidden="true">✳</div>
		<div>
			<p class="eyebrow">{eyebrow}</p>
			<h1>{title}</h1>
		</div>
		<span class="save-status" role="status" aria-live="polite" aria-busy={busy}>
			<span aria-hidden="true" class:unsaved></span>
			{status}
		</span>
	</div>

	<div class="header-actions">
		{#if readOnlyNotice}
			<!-- A disabled <button> shows no tooltip in some browsers, so the notice is also visible text. -->
			<span class="read-only" title={readOnlyNotice}>Read-only</span>
		{/if}
		<button
			type="button"
			class="save-button"
			disabled={!canSave || busy || !onsave || !!readOnlyNotice}
			title={readOnlyNotice}
			onclick={() => onsave?.()}
		>
			{saveLabel}
		</button>
		<div class="history-group" role="group" aria-label="History">
			<button
				type="button"
				aria-label="Undo"
				title="Undo (Ctrl+Z)"
				disabled={!canUndo || !onundo}
				onclick={() => onundo?.()}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><path d="M7 5 3.5 8.5 7 12M4 8.5h8a4 4 0 0 1 0 8H9" /></svg
				>
			</button>
			<button
				type="button"
				aria-label="Redo"
				title="Redo (Ctrl+Shift+Z)"
				disabled={!canRedo || !onredo}
				onclick={() => onredo?.()}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><path d="m13 5 3.5 3.5L13 12m3.5-3.5h-8a4 4 0 0 0 0 8H11" /></svg
				>
			</button>
		</div>
		<button
			type="button"
			class="preview-button"
			disabled={!onpreview}
			title={onpreview ? undefined : 'Open a page in the editor to preview it'}
			onclick={() => onpreview?.()}
		>
			{#if previewing}
				Back to editor
			{:else}
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" /><circle
						cx="10"
						cy="10"
						r="2"
					/></svg
				>
				Preview
			{/if}
		</button>
	</div>
</header>

<style>
	.read-only {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: #f1f1f5;
		color: #898ba0;
		font-size: 0.68rem;
		font-weight: 700;
		cursor: help;
	}

	.builder-header {
		display: flex;
		min-height: 76px;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem 1rem;
		padding: 0 1.5rem;
		border-bottom: 1px solid #ebebf1;
		background: #fff;
	}

	.project-name,
	.header-actions,
	.save-status,
	.history-group {
		display: flex;
		flex-direction: row;
		align-items: center;
	}

	.project-name {
		min-width: 0;
		gap: 0.8rem;
	}

	.brand-mark {
		display: grid;
		width: 38px;
		height: 38px;
		place-items: center;
		border-radius: 12px;
		background: #eeeaff;
		color: #6b5ce7;
		font-size: 1.4rem;
	}

	.eyebrow {
		margin: 0 0 0.15rem;
		color: #9999ab;
		font-size: 0.61rem;
		font-weight: 750;
		letter-spacing: 0.13em;
	}

	h1 {
		margin: 0;
		font-size: 0.94rem;
		font-weight: 680;
		letter-spacing: -0.02em;
	}

	.save-status {
		max-width: 220px;
		gap: 0.4rem;
		margin-left: 0.35rem;
		overflow: hidden;
		color: #8d8fa1;
		font-size: 0.7rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.save-status span {
		width: 7px;
		height: 7px;
		flex: none;
		border-radius: 50%;
		background: #69c89d;
	}

	.save-status span.unsaved {
		background: #e4a746;
	}

	.header-actions {
		flex-wrap: nowrap;
		gap: 0.7rem;
	}

	.save-button,
	.preview-button {
		display: flex;
		min-height: 38px;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0 0.95rem;
		border: 1px solid #e6e3f5;
		border-radius: 8px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 650;
		cursor: pointer;
	}

	.save-button {
		border-color: #6b5ce7;
		background: #6b5ce7;
		color: #fff;
	}

	.save-button:hover:not(:disabled) {
		background: #5949d2;
	}

	.preview-button {
		background: #fff;
		color: #4b456f;
	}

	.preview-button:hover:not(:disabled) {
		border-color: #c9c1ff;
		background: #faf9ff;
	}

	.save-button:disabled,
	.preview-button:disabled,
	.history-group button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.history-group {
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid #ebebf1;
		border-radius: 9px;
	}

	.history-group button {
		display: grid;
		width: 32px;
		height: 30px;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #5f6078;
		cursor: pointer;
	}

	.history-group button:hover:not(:disabled) {
		background: #f0edff;
		color: #6b5ce7;
	}

	svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}

	@media (max-width: 700px) {
		.builder-header {
			min-height: 68px;
			padding: 0.5rem 0.8rem;
		}

		.save-status {
			display: none;
		}

		.header-actions {
			width: 100%;
			justify-content: flex-end;
			gap: 0.4rem;
		}

		.save-button,
		.preview-button {
			min-height: 34px;
			padding: 0 0.65rem;
			font-size: 0.7rem;
		}
	}
</style>
