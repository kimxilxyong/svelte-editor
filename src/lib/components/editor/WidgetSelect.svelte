<script lang="ts">
	/**
	 * @component WidgetSelect
	 * Dropdown selection menu widget for picking from options.
	 *
	 * @prop {string} [id] - Select element ID.
	 * @prop {string} title - Menu label text.
	 * @prop {string} body - Explanatory helper caption.
	 * @prop {string} [value=''] - Two-way bindable selected value.
	 * @prop {() => void} [onchange] - Change event callback.
	 */
	const generatedId = $props.id();
	let {
		id = '',
		title,
		body,
		value = $bindable(''),
		onchange
	}: { id?: string; title: string; body: string; value?: string; onchange?: () => void } = $props();
	let inputId = $derived(id || generatedId);
</script>

<div class="widget-preview widget-form">
	<label for={inputId}>{title}</label>
	<select bind:value id={inputId} onchange={() => onchange?.()}>
		<option value="">Choose an option</option>
		<option value="Canada">Canada</option>
		<option value="United States">United States</option>
		<option value="United Kingdom">United Kingdom</option>
	</select>
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
	.widget-form select {
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
	.widget-form select:focus {
		border-color: #9285ec;
		outline: 3px solid rgb(119 102 223 / 12%);
	}
</style>
