<script lang="ts">
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
	<label for={inputId}>
		<input
			id={inputId}
			type="radio"
			name={inputId}
			{checked}
			onchange={(event) => {
				if (event.currentTarget.checked) checked = true;
				onchange?.();
			}}
		/>
		<span><strong>{title}</strong><small>{body}</small></span>
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
	.widget-choice input[type='radio'] {
		width: 18px;
		height: 18px;
		accent-color: #6b5ce7;
	}
</style>
