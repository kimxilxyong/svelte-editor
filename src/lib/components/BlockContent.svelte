<script lang="ts">
	/**
	 * @component BlockContent
	 *
	 * Renders the visible content of one {@link BuilderBlock}: the matching section/widget
	 * component for its `kind`, or a placeholder card for `custom:<Name>` imported components.
	 * It is the single place that maps block kinds to components, shared by the editor canvas
	 * (editable, with selection overlays added by the host) and by {@link PageView} (the
	 * read-only page rendering used for the home overview and previews).
	 *
	 * @prop {BuilderBlock} block - The block to render. `$bindable()`: interactive widgets write
	 *   `value`, `checked` and `level` back to it.
	 * @prop {() => void} [onchange] - Called when the user edits a widget value (the editor uses it
	 *   to mark the page unsaved).
	 * @prop {(event: MouseEvent, block: BuilderBlock) => void} [onlink] - Called when a link widget is
	 *   clicked, so the host can decide between in-app navigation and a blocked click.
	 *
	 * @example
	 * <BlockContent bind:block onchange={markUnsaved} onlink={handleLinkClick} />
	 */
	import Hero from './editor/Hero.svelte';
	import TextSection from './editor/TextSection.svelte';
	import ButtonSection from './editor/ButtonSection.svelte';
	import Features from './editor/Features.svelte';
	import ImageSection from './editor/ImageSection.svelte';
	import Quote from './editor/Quote.svelte';
	import WidgetButton from './editor/WidgetButton.svelte';
	import WidgetTextField from './editor/WidgetTextField.svelte';
	import WidgetTextarea from './editor/WidgetTextarea.svelte';
	import WidgetCheckbox from './editor/WidgetCheckbox.svelte';
	import WidgetRadio from './editor/WidgetRadio.svelte';
	import WidgetSwitch from './editor/WidgetSwitch.svelte';
	import WidgetSelect from './editor/WidgetSelect.svelte';
	import WidgetSlider from './editor/WidgetSlider.svelte';
	import WidgetBadge from './editor/WidgetBadge.svelte';
	import WidgetAlert from './editor/WidgetAlert.svelte';
	import WidgetProgress from './editor/WidgetProgress.svelte';
	import WidgetAvatar from './editor/WidgetAvatar.svelte';
	import WidgetCard from './editor/WidgetCard.svelte';
	import WidgetLink from './editor/WidgetLink.svelte';
	import type { BuilderBlock } from '../editor.js';

	let {
		block = $bindable(),
		onchange,
		onlink
	}: {
		block: BuilderBlock;
		onchange?: () => void;
		onlink?: (event: MouseEvent, block: BuilderBlock) => void;
	} = $props();
</script>

{#if block.kind === 'hero'}
	<Hero title={block.title} body={block.body} action={block.action} theme={block.theme} />
{:else if block.kind === 'text'}
	<TextSection title={block.title} body={block.body} theme={block.theme} />
{:else if block.kind === 'button'}
	<ButtonSection title={block.title} body={block.body} action={block.action} theme={block.theme} />
{:else if block.kind === 'features'}
	<Features title={block.title} body={block.body} theme={block.theme} />
{:else if block.kind === 'image'}
	<ImageSection title={block.title} body={block.body} theme={block.theme} />
{:else if block.kind === 'quote'}
	<Quote title={block.title} body={block.body} action={block.action} theme={block.theme} />
{:else if block.kind === 'widget-button'}
	<WidgetButton action={block.action} body={block.body} {onchange} />
{:else if block.kind === 'widget-text-field'}
	<WidgetTextField
		id={block.id}
		title={block.title}
		action={block.action}
		body={block.body}
		bind:value={block.value}
		{onchange}
	/>
{:else if block.kind === 'widget-textarea'}
	<WidgetTextarea
		id={block.id}
		title={block.title}
		action={block.action}
		body={block.body}
		bind:value={block.value}
		{onchange}
	/>
{:else if block.kind === 'widget-checkbox'}
	<WidgetCheckbox
		id={block.id}
		title={block.title}
		body={block.body}
		bind:checked={block.checked}
		{onchange}
	/>
{:else if block.kind === 'widget-radio'}
	<WidgetRadio
		id={block.id}
		title={block.title}
		body={block.body}
		bind:checked={block.checked}
		{onchange}
	/>
{:else if block.kind === 'widget-switch'}
	<WidgetSwitch
		id={block.id}
		title={block.title}
		body={block.body}
		bind:checked={block.checked}
		{onchange}
	/>
{:else if block.kind === 'widget-select'}
	<WidgetSelect
		id={block.id}
		title={block.title}
		body={block.body}
		bind:value={block.value}
		{onchange}
	/>
{:else if block.kind === 'widget-slider'}
	<WidgetSlider
		id={block.id}
		title={block.title}
		body={block.body}
		bind:level={block.level}
		{onchange}
	/>
{:else if block.kind === 'widget-badge'}
	<WidgetBadge title={block.title} body={block.body} />
{:else if block.kind === 'widget-alert'}
	<WidgetAlert title={block.title} body={block.body} />
{:else if block.kind === 'widget-progress'}
	<WidgetProgress title={block.title} body={block.body} bind:level={block.level} />
{:else if block.kind === 'widget-avatar'}
	<WidgetAvatar title={block.title} body={block.body} />
{:else if block.kind === 'widget-card'}
	<WidgetCard title={block.title} body={block.body} action={block.action} {onchange} />
{:else if block.kind === 'widget-link'}
	<WidgetLink
		title={block.title}
		body={block.body}
		href={block.href}
		newTab={block.newTab}
		onnavigate={(event) => onlink?.(event, block)}
	/>
{:else if block.kind.startsWith('custom:')}
	<div class="custom-block-preview">
		<div class="custom-badge-row">
			<span class="custom-pill">✳ {block.kind.slice(7)}</span>
		</div>
		<h4>{block.title || block.kind.slice(7)}</h4>
		{#if block.body}<p>{block.body}</p>{/if}
		{#if block.customProps && Object.keys(block.customProps).length > 0}
			<div class="custom-props-preview">
				{#each Object.entries(block.customProps) as [k, v] (k)}
					<span class="custom-prop-tag"><code>{k}</code>: {String(v)}</span>
				{/each}
			</div>
		{/if}
	</div>{/if}

<style>
	.custom-block-preview {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		box-sizing: border-box;
		background: #fff;
		border-radius: 8px;
		border: 1px dashed #c9c1ff;
	}

	.custom-badge-row {
		margin-bottom: 0.4rem;
	}

	.custom-pill {
		display: inline-block;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: #eeeaff;
		color: #6b5ce7;
		font-size: 0.65rem;
		font-weight: 700;
	}

	.custom-block-preview h4 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: #20233a;
	}

	.custom-block-preview p {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: #898ba0;
	}

	.custom-props-preview {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: auto;
	}

	.custom-prop-tag {
		font-size: 0.65rem;
		background: #f7f7fa;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		border: 1px solid #e8e8ed;
		color: #4b456f;
	}
</style>
