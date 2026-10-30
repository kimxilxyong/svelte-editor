<script lang="ts">
	/**
	 * @component PasswordInput
	 *
	 * The single password entry control of the whole app (sign in, register, setup, account,
	 * admin user dialogs and the Postgres connection builder). Using one component keeps the look
	 * and the behaviour identical everywhere:
	 *
	 * - a **pale yellow** field (the colour browsers use for autofilled credentials – the autofill
	 *   colour is pinned to the same yellow so filled and empty fields never look different),
	 * - an **eye button** inside the field that reveals / hides the typed password.
	 *
	 * ## Usage contract
	 * The component renders only the field (wrapper + `<input>` + eye button) – **not** the label,
	 * hint or error text. The host keeps its own `<label for>` and passes the matching `id`.
	 * Every other native input attribute (`name`, `autocomplete`, `required`, `minlength`,
	 * `maxlength`, `placeholder`, `aria-*`, `onblur`, `oninput`, …) is forwarded to the `<input>`.
	 *
	 * ## Security notes
	 * - The input is `type="password"` unless the user explicitly reveals it; the reveal state is
	 *   local UI state (never persisted) and resets when the component is destroyed.
	 * - The eye button is `type="button"` so it can never submit the surrounding form and carries
	 *   no `name`, so it never ends up in a `FormData`.
	 * - Pass a `name` only on fields that must be submitted; leave it out for helper inputs (the
	 *   Postgres builder does this so the password is not posted twice).
	 *
	 * ## Styling
	 * The wrapper fills the available width. Host stylesheets that target `.field input` (the
	 * auth card, the admin shell) have lower priority than the doubled `.pw-input` selector below,
	 * so the field looks the same in every context.
	 *
	 * @prop {string} [value=''] - Bindable password text.
	 * @prop {boolean} [revealed=false] - Bindable: `true` shows the password as plain text. Hosts
	 *   may bind it to reveal programmatically (e.g. after generating a password).
	 * @prop {string} [class=''] - Extra class(es) for the wrapper element.
	 * @prop {import('svelte/elements').HTMLInputAttributes} [...rest] - Forwarded to the `<input>`
	 *   (except `type`, which this component controls).
	 *
	 * @example
	 * <label for="pw">Password</label>
	 * <PasswordInput id="pw" name="password" autocomplete="current-password" required />
	 *
	 * @example
	 * <!-- Controlled value + programmatic reveal -->
	 * <PasswordInput id="pw" bind:value={secret} bind:revealed={show} />
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'type' | 'value' | 'class'> {
		value?: string;
		revealed?: boolean;
		class?: string;
	}

	let {
		value = $bindable(''),
		revealed = $bindable(false),
		class: className = '',
		...rest
	}: Props = $props();
</script>

<div class="password-input {className}">
	<input {...rest} class="pw-input" type={revealed ? 'text' : 'password'} bind:value />
	<button
		type="button"
		class="eye"
		aria-label={revealed ? 'Hide password' : 'Show password'}
		aria-pressed={revealed}
		title={revealed ? 'Hide password' : 'Show password'}
		onclick={() => (revealed = !revealed)}
	>
		{#if revealed}
			<!-- eye with a slash: the password is visible, click to hide it -->
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M3 3l18 18" />
				<path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c5.5 0 9 6 9 6a16.6 16.6 0 0 1-3.2 3.9" />
				<path d="M6.5 7.6A16.2 16.2 0 0 0 3 12s3.5 6 9 6a9.6 9.6 0 0 0 4-.9" />
				<path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
			</svg>
		{:else}
			<!-- open eye: the password is hidden, click to reveal it -->
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		{/if}
	</button>
</div>

<style>
	.password-input {
		--pw-bg: #fff8d6;
		--pw-border: #e6d68b;
		position: relative;
		display: block;
		width: 100%;
		min-width: 0;
	}

	/* `.pw-input.pw-input` doubles the specificity so `.auth-card .field input` /
	   `.field-control` rules of the host cannot repaint the field. */
	.password-input .pw-input.pw-input {
		box-sizing: border-box;
		width: 100%;
		min-height: 2.5rem;
		/* Right padding leaves room for the eye button. */
		padding: 0.55rem 2.6rem 0.55rem 0.75rem;
		border: 1px solid var(--pw-border);
		border-radius: 9px;
		background: var(--pw-bg);
		color: #20233a;
		font: inherit;
	}

	.password-input .pw-input.pw-input:focus-visible {
		border-color: #6b5ce7;
		outline: 2px solid rgb(107 92 231 / 25%);
		outline-offset: 0;
	}

	.password-input .pw-input.pw-input[aria-invalid='true'] {
		border-color: #d6334a;
	}

	.password-input .pw-input.pw-input:disabled {
		opacity: 0.6;
	}

	/* Browser autofill paints its own background; an inset shadow pins it to our yellow. */
	.password-input .pw-input.pw-input:-webkit-autofill,
	.password-input .pw-input.pw-input:-webkit-autofill:focus {
		-webkit-box-shadow: 0 0 0 100px var(--pw-bg) inset;
		-webkit-text-fill-color: #20233a;
	}

	/* Doubled class (`.eye.eye`): beats host rules such as `.auth-card button` that would turn the
	   eye into a regular padded, bordered button. */
	.password-input .eye.eye {
		position: absolute;
		top: 50%;
		right: 0.3rem;
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		min-height: 0;
		padding: 0;
		transform: translateY(-50%);
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: #6c6e85;
		cursor: pointer;
	}

	.password-input .eye.eye:hover {
		background: rgb(0 0 0 / 6%);
		color: #20233a;
	}

	.password-input .eye.eye:focus-visible {
		outline: 2px solid #6b5ce7;
		outline-offset: 1px;
	}

	.password-input .eye.eye[aria-pressed='true'] {
		color: #6b5ce7;
	}

	svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.8;
	}
</style>
