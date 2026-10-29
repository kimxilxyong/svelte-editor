<script lang="ts">
	/**
	 * @component WidgetSwitch
	 * Accessible toggle switch widget for turning settings on and off.
	 *
	 * @prop {string} [id] - Unique switch element ID.
	 * @prop {string} title - Switch label text.
	 * @prop {string} body - Status or context explanation.
	 * @prop {boolean} [checked=false] - Two-way bindable switch state.
	 * @prop {() => void} [onchange] - Change event callback.
	 */
	const generatedId = $props.id();
	let {
		id = '',
		title,
		body,
		checked = $bindable(false),
		onchange
	}: {
		id?: string;
		title: string;
		body: string;
		checked?: boolean;
		onchange?: () => void;
	} = $props();
	let inputId = $derived(id || generatedId);
</script>

<div class="widget-preview widget-choice">
	<label class="switch-control" for={inputId}>
		<span><strong>{title}</strong><small>{body}</small></span>
		<input id={inputId} type="checkbox" role="switch" bind:checked onchange={() => onchange?.()} />
		<span class="switch-track" aria-hidden="true"></span>
	</label>
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
	.widget-choice {
		justify-content: center;
	}
	.widget-choice label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		cursor: pointer;
	}
	.widget-choice label > span {
		display: grid;
		gap: 0.25rem;
	}
	.widget-choice strong {
		color: #43455a;
		font-size: 0.76rem;
		font-weight: 650;
	}
	.widget-choice small {
		color: #85869a;
		font-size: 0.67rem;
	}
	.widget-choice .switch-control {
		position: relative;
		justify-content: space-between;
	}
	.switch-control input {
		position: absolute;
		right: 0;
		width: 42px;
		height: 26px;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.switch-track {
		position: relative;
		width: 42px;
		height: 24px;
		flex: 0 0 42px;
		border-radius: 999px;
		background: #d9dae3;
		transition: background 120ms ease;
	}
	.switch-track::after {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
		content: '';
		transition: transform 120ms ease;
	}
	.switch-control input:checked + .switch-track {
		background: #6b5ce7;
	}
	.switch-control input:checked + .switch-track::after {
		transform: translateX(18px);
	}
	.switch-control input:focus-visible + .switch-track {
		outline: 3px solid rgb(119 102 223 / 24%);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.switch-track,
		.switch-track::after {
			transition: none;
		}
	}
</style>
