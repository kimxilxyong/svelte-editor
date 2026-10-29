<script lang="ts">
	/**
	 * @component WidgetTextarea
	 * Multi-line textarea form widget for long-form user responses.
	 *
	 * @prop {string} [id] - Optional element ID (falls back to generated ID).
	 * @prop {string} title - Field label text.
	 * @prop {string} action - Textarea placeholder text.
	 * @prop {string} body - Helper text below textarea.
	 * @prop {string} [value] - Two-way bindable textarea content.
	 * @prop {() => void} [onchange] - Input change callback.
	 */
	const generatedId = $props.id();
	let {
		id = '',
		title,
		action,
		body,
		value = $bindable(''),
		onchange
	}: {
		id?: string;
		title: string;
		action: string;
		body: string;
		value?: string;
		onchange?: () => void;
	} = $props();
	let inputId = $derived(id || generatedId);
</script>

<div class="widget-preview widget-form">
	<label for={inputId}>{title}</label>
	<textarea
		id={inputId}
		placeholder={action}
		bind:value
		maxlength="100"
		oninput={() => onchange?.()}></textarea>
	<p>{body}</p>
</div>

<style>
	.widget-preview {
		width: 100%;
		height: 100%;
		min-height: 130px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.7rem;
		padding: 1.5rem;
		overflow: auto;
		background: #fff;
		color: #323449;
		font-size: 0.78rem;
	}
	.widget-preview p {
		margin: 0;
		color: #85869a;
		font-size: 0.68rem;
		line-height: 1.55;
	}
	.widget-form {
		align-items: stretch;
	}
	.widget-form label {
		color: #4a4b60;
		font-size: 0.72rem;
		font-weight: 650;
	}
	.widget-form textarea {
		width: 100%;
		min-height: 40px;
		box-sizing: border-box;
		padding: 0.6rem 0.7rem;
		border: 1px solid #dfe0e8;
		border-radius: 7px;
		background: #fff;
		color: #393b50;
		font: inherit;
		font-size: 0.72rem;
	}
	.widget-form textarea:focus {
		border-color: #9285ec;
		outline: 3px solid rgb(119 102 223 / 12%);
	}
	.widget-form textarea {
		min-height: 90px;
		resize: vertical;
	}
</style>
