<script lang="ts">
	/**
	 * @component ThemePage
	 *
	 * `/theme` – edits the site-wide theme: colour preset or custom primary colour, corner radius,
	 * font family and dark mode. The preview on the right renders real widgets inside a
	 * {@link ThemeScope}, so what you see is exactly what the editor canvas, page previews and exported
	 * projects will use. Saving stores the theme in the database (power users and above); the root
	 * layout then reloads it for every page.
	 *
	 * Data flow: `data.siteTheme` (root layout) is the saved theme; `draft` is the local edit state;
	 * the preview and the save form both read `draft`.
	 *
	 * @prop {import('./$types').PageData} data - `siteTheme` (saved theme) and `canEdit`.
	 * @prop {import('./$types').ActionData} form - Result of the `save` action (`saved` or `error`).
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import BlockContent from '../../lib/components/BlockContent.svelte';
	import ThemeScope from '../../lib/components/editor/ThemeScope.svelte';
	import { widgetCatalog } from '../../lib/widget-catalog.js';
	import {
		themeFonts,
		themePresets,
		themeRadii,
		type SiteTheme,
		type ThemeRadius,
		type ThemeFont
	} from '../../lib/theme.js';
	import type { BuilderBlock, WidgetKind } from '../../lib/editor.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let draft = $state<SiteTheme>({ ...data.siteTheme });
	let saving = $state(false);
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(data.siteTheme));

	/** Widgets shown in the preview, in display order. */
	const previewKinds: WidgetKind[] = [
		'widget-button',
		'widget-text-field',
		'widget-select',
		'widget-checkbox',
		'widget-switch',
		'widget-slider',
		'widget-progress',
		'widget-badge',
		'widget-alert',
		'widget-avatar',
		'widget-card',
		'widget-link'
	];

	/** Builds a preview block of a widget kind from its catalog defaults. */
	function previewBlock(kind: WidgetKind): BuilderBlock {
		const d = widgetCatalog[kind].defaults;
		return {
			id: `preview-${kind}`,
			kind,
			title: d.title,
			body: d.body,
			action: d.action,
			theme: d.theme ?? 'light',
			positioned: true,
			x: 0,
			y: 0,
			width: d.width,
			height: d.height,
			value: kind === 'widget-select' ? d.action : '',
			checked: false,
			level: d.level ?? 60,
			href: kind === 'widget-link' ? '/' : '',
			newTab: false,
			...(d.items ? { items: d.items } : {})
		};
	}
	let previews = $state(previewKinds.map(previewBlock));

	function pickPreset(id: string, primary: string) {
		draft.preset = id;
		draft.primary = primary;
	}
</script>

<svelte:head><title>Theme</title></svelte:head>

<div class="theme-page">
	<section class="panel" aria-labelledby="theme-heading">
		<h1 id="theme-heading">Site theme</h1>
		<p class="hint">
			Applies to widgets on the canvas, in previews and in exported projects. The editor's own
			interface keeps its look.
		</p>

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update({ reset: false });
					await invalidateAll();
					saving = false;
				};
			}}
		>
			<input type="hidden" name="theme" value={JSON.stringify(draft)} />

			<fieldset disabled={!data.canEdit}>
				<legend>Colour</legend>
				<div class="swatches" role="radiogroup" aria-label="Colour preset">
					{#each themePresets as preset (preset.id)}
						<button
							type="button"
							role="radio"
							aria-checked={draft.preset === preset.id}
							class="swatch"
							class:active={draft.preset === preset.id}
							style:--swatch={preset.primary}
							onclick={() => pickPreset(preset.id, preset.primary)}
						>
							<span class="dot"></span>{preset.label}
						</button>
					{/each}
				</div>
				<label class="row">
					<span>Custom primary colour</span>
					<input
						type="color"
						value={draft.primary}
						oninput={(event) => {
							draft.primary = event.currentTarget.value;
							draft.preset = 'custom';
						}}
					/>
					<code>{draft.primary}</code>
				</label>
			</fieldset>

			<fieldset disabled={!data.canEdit}>
				<legend>Corners</legend>
				<div class="choices">
					{#each themeRadii as option (option.value)}
						<label class:active={draft.radius === option.value}>
							<input
								type="radio"
								name="radius"
								value={option.value}
								checked={draft.radius === option.value}
								onchange={() => (draft.radius = option.value as ThemeRadius)}
							/>
							{option.label}
						</label>
					{/each}
				</div>
			</fieldset>

			<fieldset disabled={!data.canEdit}>
				<legend>Appearance</legend>
				<label class="row">
					<span>Font</span>
					<select bind:value={draft.font}>
						{#each themeFonts as option (option.value)}
							<option value={option.value as ThemeFont}>{option.label}</option>
						{/each}
					</select>
				</label>
				<label class="row">
					<input type="checkbox" bind:checked={draft.dark} />
					<span>Dark mode</span>
				</label>
			</fieldset>

			<div class="actions">
				<button type="submit" class="primary" disabled={!data.canEdit || !dirty || saving}>
					{saving ? 'Saving…' : 'Save theme'}
				</button>
				<button type="button" disabled={!dirty} onclick={() => (draft = { ...data.siteTheme })}>
					Revert
				</button>
			</div>
			{#if !data.canEdit}
				<p class="hint" role="status">Read-only: saving the theme needs the power user role.</p>
			{/if}
			{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
			{#if form?.saved && !dirty}<p class="ok" role="status">Theme saved.</p>{/if}
		</form>
	</section>

	<section class="panel preview-panel" aria-label="Live preview">
		<h2>Preview</h2>
		<ThemeScope theme={draft}>
			<div class="preview">
				{#each previews as block, index (block.id)}
					<div class="preview-item" style:width="{block.width}px" style:height="{block.height}px">
						<BlockContent bind:block={previews[index]} />
					</div>
				{/each}
			</div>
		</ThemeScope>
	</section>
</div>

<style>
	.theme-page {
		display: grid;
		grid-template-columns: minmax(280px, 380px) 1fr;
		gap: 1.5rem;
		width: min(100%, 1200px);
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.panel {
		padding: 1.25rem;
		border: 1px solid #e3e1f4;
		border-radius: 12px;
		background: #fff;
	}

	h1 {
		margin: 0 0 0.25rem;
		font-size: 1.4rem;
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
	}

	fieldset {
		margin: 1rem 0 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.5rem;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #6b6d85;
	}

	.hint {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: #6b6d85;
	}

	.swatches,
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.swatch,
	.choices label,
	.actions button {
		padding: 0.35rem 0.7rem;
		border: 1px solid #d4d1ee;
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.swatch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.dot {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 50%;
		background: var(--swatch);
	}

	.swatch.active,
	.choices label.active {
		border-color: #7766df;
		box-shadow: 0 0 0 2px #e7e3ff;
	}

	.choices input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
		font-size: 0.9rem;
	}

	.row span:first-child {
		min-width: 9rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.actions .primary {
		border-color: #7766df;
		background: #7766df;
		color: #fff;
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error {
		color: #b42318;
	}

	.ok {
		color: #067647;
	}

	.preview {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem 1.75rem;
		padding: 1.25rem;
		border-radius: 10px;
		background: var(--site-bg);
		color: var(--site-fg);
	}

	.preview-item {
		position: relative;
		max-width: 100%;
	}

	@media (max-width: 800px) {
		.theme-page {
			grid-template-columns: 1fr;
		}
	}
</style>
