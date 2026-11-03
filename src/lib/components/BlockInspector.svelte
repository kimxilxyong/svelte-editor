<script lang="ts">
	/**
	 * @component BlockInspector
	 *
	 * The "Make it yours" inspector of the visual editor: edits the fields of ONE selected block.
	 * It is purely presentational. `SiteEditor` keeps the dirty flag, history, navigation and
	 * persistence and hands in callbacks; this component never saves or navigates by itself.
	 *
	 * Which content controls appear is decided only by {@link inspectorFields} (the capability map in
	 * `inspector-fields.ts`), so a control exists only when the widget renders that field. Universal
	 * controls (layer order, Align To, fixed position/size, theme) are always shown for a selection.
	 *
	 * Link Navigation (`widget-link`, `widget-button`, `widget-card` CTA) edits the existing
	 * `href` / `newTab` block fields with page-route suggestions and {@link isValidLinkHref} validation.
	 *
	 * Data flow: the block is mutated in place through `bind:` (the host passes a function binding to
	 * its derived selection) and every text/option edit calls `onchange` so the host marks the
	 * document unsaved. Geometry edits additionally call `onposition(field)` so the host can clamp
	 * the value and record history. Alignment edits call `onalign`; the host disables Fill when a
	 * different block on the same canvas already owns it.
	 *
	 * Coordinates: pixels relative to the canvas top-left corner (see {@link blockLimits}).
	 *
	 * @prop {BuilderBlock | undefined} block - `$bindable()`. The selected block, or `undefined` for the empty state.
	 * @prop {string} label - Display name of the selected block's kind.
	 * @prop {string} mark - Glyph of the selected block's kind.
	 * @prop {{ id: string; name: string; slug: string }[]} [linkPages=[]] - Internal pages offered as link suggestions.
	 * @prop {{ id: string; name: string }} [compositeEdit] - Composite a `composite:` block instantiates; shows an "Edit composite" link.
	 * @prop {SiteTheme} [siteTheme] - Site theme whose foreground/background are the colour pickers' defaults.
	 * @prop {() => void} onchange - A content value was edited (mark unsaved).
	 * @prop {boolean} [hasFillBlock=false] - Another block on this canvas already uses Fill.
	 * @prop {(alignment: AlignTo) => void} onalign - Align To was changed.
	 * @prop {(field: 'x' | 'y' | 'width' | 'height') => void} onposition - A geometry value was edited.
	 * @prop {(action: 'front' | 'back' | 'forward' | 'backward') => void} onreorder - Change the layer order.
	 * @prop {() => void} onduplicate - Duplicate the selected block.
	 * @prop {() => void} ondelete - Delete the selected block.
	 *
	 * @example
	 * <BlockInspector bind:block={() => selectedBlock, () => {}} label="Button" mark="↗"
	 *   {linkPages} onchange={markUnsaved} onposition={clamp} onreorder={reorder}
	 *   onduplicate={duplicate} ondelete={remove} />
	 */
	import { resolve } from '$app/paths';
	import { page as routePage } from '$app/state';
	import { blockLimits, isValidLinkHref, type AlignTo, type BuilderBlock } from '../editor.js';
	import {
		imageCategories,
		imagePathElement,
		listImagePathElements,
		prepopulatedImages,
		type ImageCategory,
		type ManagedImage
	} from '../images.js';
	import { defaultSiteTheme, siteBackground, siteForeground, type SiteTheme } from '../theme.js';
	import { inspectorFields } from '../inspector-fields.js';
	import { widgetCatalog } from '../widget-catalog.js';

	type LayerAction = 'front' | 'back' | 'forward' | 'backward';
	type GeometryField = 'x' | 'y' | 'width' | 'height';

	let {
		block = $bindable(),
		label,
		mark,
		linkPages = [],
		availableImages,
		compositeEdit,
		hasFillBlock = false,
		siteTheme = defaultSiteTheme,
		onchange,
		onalign,
		onposition,
		onreorder,
		onduplicate,
		ondelete
	}: {
		block: BuilderBlock | undefined;
		label: string;
		mark: string;
		linkPages?: { id: string; name: string; slug: string }[];
		availableImages?: ManagedImage[];
		compositeEdit?: { id: string; name: string };
		hasFillBlock?: boolean;
		siteTheme?: SiteTheme;
		onchange: () => void;
		onalign: (alignment: AlignTo) => void;
		onposition: (field: GeometryField) => void;
		onreorder: (action: LayerAction) => void;
		onduplicate: () => void;
		ondelete: () => void;
	} = $props();

	const uid = $props.id();
	/** Capabilities of the selected block's kind; empty object when nothing is selected. */
	const fields = $derived(block ? inspectorFields(block.kind) : {});
	const hrefValid = $derived(block ? isValidLinkHref(block.href) : true);
	const hrefExternal = $derived(block ? /^https?:\/\//i.test(block.href) : false);
	/** Entries of the select widget (the block's own list, or the catalog sample). */
	const selectOptions = $derived(
		(block?.items || widgetCatalog['widget-select'].defaults.items || '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);

	/** Managed images offered in the widget image picker (layout data or prepopulated fallback). */
	const catalogImages = $derived<readonly Pick<ManagedImage, 'id' | 'name' | 'url' | 'category'>[]>(
		availableImages ?? (routePage.data?.images as ManagedImage[] | undefined) ?? prepopulatedImages
	);
	let imageSearch = $state('');
	let imageCategoryFilter = $state<'all' | ImageCategory>('all');
	let imagePathFilter = $state('all');
	let imageGridOpen = $state(false);

	const availablePathElements = $derived(listImagePathElements(catalogImages));

	const filteredCatalogImages = $derived(
		catalogImages.filter((item) => {
			if (imageCategoryFilter !== 'all' && item.category !== imageCategoryFilter) return false;
			if (imagePathFilter !== 'all' && imagePathElement(item.url) !== imagePathFilter) return false;
			const q = imageSearch.trim().toLowerCase();
			return !q || item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
		})
	);

	const currentImageUrl = $derived(
		block ? block.image || (block.kind === 'widget-image' ? block.action : '') : ''
	);

	function applyPickedImage(url: string) {
		if (!block) return;
		const trimmed = url.trim();
		block.image = trimmed || undefined;
		if (block.kind === 'widget-image') {
			block.action = trimmed;
		}
		onchange();
	}

	/**
	 * Colour pickers. Without a custom value a picker shows (and a reset returns to) the site
	 * theme's colour, so it always reflects what is actually rendered.
	 */
	const colorFields = $derived<
		{ key: 'foreground' | 'background'; label: string; fallback: string }[]
	>([
		{ key: 'foreground', label: 'Foreground', fallback: siteForeground(siteTheme) },
		{ key: 'background', label: 'Background', fallback: siteBackground(siteTheme) }
	]);
</script>

<div class="panel-heading inspector-heading">
	<div>
		<p class="eyebrow">MAKE IT YOURS</p>
		<h2>Inspector</h2>
	</div>
	{#if block}
		<div class="inspector-actions">
			<button
				class="icon-button"
				type="button"
				aria-label="Duplicate selected block"
				title="Duplicate (Ctrl+D)"
				onclick={onduplicate}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><rect x="7" y="7" width="9" height="9" rx="1.5" /><path
						d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2"
					/></svg
				>
			</button>
			<button
				class="icon-button delete-button"
				type="button"
				aria-label="Delete selected block"
				onclick={ondelete}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><path d="M4.5 6h11m-9.5 0 .6 10h6.8l.6-10M8 6V4h4v2m-3 3v4m2-4v4" /></svg
				>
			</button>
		</div>
	{/if}
</div>
{#if block}
	{@const current = block}
	<div class="inspector-content">
		<div class="selected-component">
			<span class="component-mark" aria-hidden="true">{mark}</span>
			<div><strong>{label}</strong><small>Selected block</small></div>
		</div>
		{#if compositeEdit}
			<a
				class="text-button edit-composite"
				href={resolve(`/composites?composite=${encodeURIComponent(compositeEdit.id)}`)}
				>Edit composite “{compositeEdit.name}”</a
			>
		{/if}
		<span class="field-label">Layer</span>
		<div class="layer-buttons">
			<button type="button" onclick={() => onreorder('back')}>To back</button>
			<button type="button" onclick={() => onreorder('backward')}>Backward</button>
			<button type="button" onclick={() => onreorder('forward')}>Forward</button>
			<button type="button" onclick={() => onreorder('front')}>To front</button>
		</div>
		<label class="field-label" for="{uid}-align-to">Align To</label>
		<select
			id="{uid}-align-to"
			class="field-control"
			aria-label="Align To"
			value={current.alignTo ?? 'none'}
			onchange={(event) => onalign(event.currentTarget.value as AlignTo)}
		>
			<option value="none">None</option>
			<option value="left">Left</option>
			<option value="right">Right</option>
			<option value="top">Top</option>
			<option value="bottom">Bottom</option>
			<option value="fill" disabled={hasFillBlock}>Fill</option>
		</select>
		<p class="panel-hint align-hint">
			{#if current.alignTo === 'left' || current.alignTo === 'right'}
				Width sets the docked strip thickness; its height fills the remaining canvas.
			{:else if current.alignTo === 'top' || current.alignTo === 'bottom'}
				Height sets the docked strip thickness; its width fills the remaining canvas.
			{:else if current.alignTo === 'fill'}
				This block fills the remaining canvas area. Only one Fill block is allowed.
			{:else}
				Keep the block at its fixed position, or dock it to a canvas edge.
			{/if}
		</p>
		<span class="field-label">Fixed position</span>
		<p class="position-hint">Adjust the block geometry, or its strip thickness when docked.</p>
		<div class="position-fields">
			<div>
				<label class="field-label" for="{uid}-x">Left (px)</label>
				<input
					id="{uid}-x"
					class="field-control"
					type="number"
					min="0"
					max={blockLimits.maxX - current.width}
					step="1"
					bind:value={current.x}
					disabled={current.alignTo !== undefined && current.alignTo !== 'none'}
					oninput={() => onposition('x')}
				/>
			</div>
			<div>
				<label class="field-label" for="{uid}-y">Top (px)</label>
				<input
					id="{uid}-y"
					class="field-control"
					type="number"
					min="0"
					max={blockLimits.maxY}
					step="1"
					bind:value={current.y}
					disabled={current.alignTo !== undefined && current.alignTo !== 'none'}
					oninput={() => onposition('y')}
				/>
			</div>
			<div>
				<label class="field-label" for="{uid}-width">Width (px)</label>
				<input
					id="{uid}-width"
					class="field-control"
					type="number"
					min={blockLimits.minWidth}
					max={blockLimits.maxWidth -
						(current.alignTo === 'left' || current.alignTo === 'right' ? 0 : current.x)}
					step="1"
					bind:value={current.width}
					disabled={current.alignTo === 'top' ||
						current.alignTo === 'bottom' ||
						current.alignTo === 'fill'}
					oninput={() => onposition('width')}
				/>
			</div>
			<div>
				<label class="field-label" for="{uid}-height">Height (px)</label>
				<input
					id="{uid}-height"
					class="field-control"
					type="number"
					min={blockLimits.minHeight}
					max={blockLimits.maxHeight}
					step="1"
					bind:value={current.height}
					disabled={current.alignTo === 'left' ||
						current.alignTo === 'right' ||
						current.alignTo === 'fill'}
					oninput={() => onposition('height')}
				/>
			</div>
		</div>

		{#if fields.title}
			<label class="field-label" for="{uid}-title">{fields.title}</label>
			<input
				id="{uid}-title"
				class="field-control"
				bind:value={current.title}
				maxlength="100"
				oninput={onchange}
			/>
		{/if}
		{#if fields.body}
			<label class="field-label" for="{uid}-body">{fields.body}</label>
			<textarea
				id="{uid}-body"
				class="field-control field-textarea"
				bind:value={current.body}
				rows="4"
				maxlength="240"
				oninput={onchange}></textarea>
		{/if}
		{#if fields.action}
			<label class="field-label" for="{uid}-action">{fields.action}</label>
			<input
				id="{uid}-action"
				class="field-control"
				bind:value={current.action}
				maxlength={current.kind === 'widget-image' || current.kind === 'widget-video' ? 500 : 48}
				oninput={() => {
					if (current.kind === 'widget-image') {
						current.image = current.action.trim() || undefined;
					}
					onchange();
				}}
			/>
		{/if}

		{#if fields.image}
			<fieldset class="link-group image-picker-group" data-testid="inspector-image-picker">
				<legend class="field-label">{fields.image.label}</legend>
				<div class="image-select-row">
					<select
						id="{uid}-image-select"
						class="field-control"
						aria-label={fields.image.label}
						value={catalogImages.some((img) => img.url === currentImageUrl) ? currentImageUrl : ''}
						onchange={(event) => applyPickedImage(event.currentTarget.value)}
					>
						<option value="">None (no image)</option>
						{#each imageCategories as cat (cat.value)}
							{@const group = catalogImages.filter((img) => img.category === cat.value)}
							{#if group.length > 0}
								<optgroup label={cat.label}>
									{#each group as img (img.id)}
										<option value={img.url}>{img.name}</option>
									{/each}
								</optgroup>
							{/if}
						{/each}
					</select>
					<button
						type="button"
						class="image-browse-toggle"
						aria-expanded={imageGridOpen}
						onclick={() => (imageGridOpen = !imageGridOpen)}
					>
						{imageGridOpen ? 'Hide grid' : 'Browse'}
					</button>
				</div>

				{#if currentImageUrl}
					<div class="picked-image-preview">
						<img src={currentImageUrl} alt="" />
						<div class="picked-image-meta">
							<strong>
								{catalogImages.find((img) => img.url === currentImageUrl)?.name ?? 'Custom URL'}
							</strong>
							<code>{currentImageUrl}</code>
						</div>
						<button
							type="button"
							class="color-reset"
							aria-label="Clear selected image"
							onclick={() => applyPickedImage('')}
						>
							Clear
						</button>
					</div>
				{/if}

				{#if imageGridOpen}
					<div class="image-browser-popover">
						<div class="image-browser-filters">
							<input
								type="search"
								class="field-control"
								placeholder="Filter images…"
								aria-label="Filter available images"
								bind:value={imageSearch}
							/>
							<select
								class="field-control"
								aria-label="Filter images by category"
								bind:value={imageCategoryFilter}
							>
								<option value="all">All categories</option>
								{#each imageCategories as cat (cat.value)}
									<option value={cat.value}>{cat.label}</option>
								{/each}
							</select>
							<select
								class="field-control"
								aria-label="Filter images by path element"
								bind:value={imagePathFilter}
							>
								<option value="all">All path folders</option>
								{#each availablePathElements as seg (seg)}
									<option value={seg}>{seg}</option>
								{/each}
							</select>
						</div>
						<div class="image-picker-grid" role="listbox" aria-label="Available images">
							{#each filteredCatalogImages as img (img.id)}
								<button
									type="button"
									role="option"
									aria-selected={currentImageUrl === img.url}
									class="image-picker-tile"
									class:active={currentImageUrl === img.url}
									title="{img.name} ({img.url})"
									onclick={() => applyPickedImage(img.url)}
								>
									<img src={img.url} alt="" loading="lazy" />
									<span>{img.name}</span>
								</button>
							{:else}
								<p class="panel-hint">No matching images.</p>
							{/each}
						</div>
						<div class="image-picker-footer">
							<a class="text-button" href={resolve('/images')}>Manage images →</a>
						</div>
					</div>
				{/if}
			</fieldset>
		{/if}

		{#if fields.link}
			<fieldset class="link-group">
				<legend class="field-label">Link Navigation</legend>
				<label class="field-label" for="{uid}-href">Link address</label>
				<input
					id="{uid}-href"
					class="field-control"
					list="{uid}-routes"
					maxlength="200"
					placeholder="/page or https://…"
					aria-invalid={!hrefValid}
					aria-describedby="{uid}-href-hint"
					bind:value={current.href}
					oninput={onchange}
				/>
				<datalist id="{uid}-routes">
					{#each linkPages as page (page.id)}<option value="/{page.slug}">{page.name}</option
						>{/each}
				</datalist>
				{#if !hrefValid}
					<p class="route-error" role="alert">Use /page-route or an http(s) address.</p>
				{/if}
				<p class="panel-hint" id="{uid}-href-hint">
					{#if fields.link.optional}
						Leave empty for a plain {current.kind === 'widget-card'
							? 'card button'
							: 'button'}.{current.kind === 'widget-card' && !current.action
							? ' The link needs a button label to be shown.'
							: ''}
					{:else}
						An internal page route or an external address.
					{/if}
				</p>
				<label class="check-row">
					<input
						type="checkbox"
						bind:checked={current.newTab}
						disabled={current.href !== '' && !hrefExternal}
						{onchange}
					/>
					Open external links in a new tab
				</label>
			</fieldset>
		{/if}

		{#if fields.selectedOption}
			<label class="field-label" for="{uid}-select-value">Selected option</label>
			<select id="{uid}-select-value" class="field-control" bind:value={current.value} {onchange}>
				<option value="">Choose an option</option>
				{#each selectOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		{/if}
		{#if fields.checked}
			<label class="widget-state-control">
				<input type="checkbox" bind:checked={current.checked} {onchange} />
				<span>Initially selected</span>
			</label>
		{/if}
		{#if fields.items}
			<label class="field-label" for="{uid}-items">Entries</label>
			<textarea
				id="{uid}-items"
				class="field-control field-textarea"
				bind:value={current.items}
				rows="6"
				maxlength="600"
				oninput={onchange}></textarea>
			<p class="panel-hint">{fields.items}</p>
		{/if}
		{#if fields.level}
			<label class="field-label" for="{uid}-level">Value ({current.level}%)</label>
			<input
				id="{uid}-level"
				class="field-control"
				type="range"
				min="0"
				max="100"
				bind:value={current.level}
				oninput={onchange}
			/>
		{/if}
		{#if fields.customProps && current.customProps && Object.keys(current.customProps).length > 0}
			{@const props = current.customProps}
			<span class="field-label">Component Props</span>
			{#each Object.entries(props) as [propKey, propVal] (propKey)}
				{#if typeof propVal === 'boolean'}
					<label class="widget-state-control">
						<input
							type="checkbox"
							checked={propVal}
							onchange={(e) => {
								props[propKey] = e.currentTarget.checked;
								onchange();
							}}
						/>
						<span>{propKey}</span>
					</label>
				{:else if typeof propVal === 'number'}
					<label class="field-label" for="{uid}-prop-{propKey}">{propKey}</label>
					<input
						id="{uid}-prop-{propKey}"
						class="field-control"
						type="number"
						value={propVal}
						oninput={(e) => {
							props[propKey] = Number(e.currentTarget.value);
							onchange();
						}}
					/>
				{:else}
					<label class="field-label" for="{uid}-prop-{propKey}">{propKey}</label>
					<input
						id="{uid}-prop-{propKey}"
						class="field-control"
						value={String(propVal)}
						oninput={(e) => {
							props[propKey] = e.currentTarget.value;
							onchange();
						}}
					/>
				{/if}
			{/each}
		{/if}

		<div class="field-divider"></div>
		<span class="field-label">Colors</span>
		<div class="color-options" role="group" aria-label="Colors">
			{#each colorFields as field (field.key)}
				{@const custom = current[field.key]}
				<div class="color-field">
					<label for="{uid}-{field.key}">{field.label}</label>
					<input
						id="{uid}-{field.key}"
						type="color"
						value={custom || field.fallback}
						oninput={(event) => {
							current[field.key] = event.currentTarget.value;
							onchange();
						}}
					/>
					<code>{custom || field.fallback}</code>
					<button
						type="button"
						class="color-reset"
						disabled={!custom}
						aria-label="Reset {field.label.toLowerCase()} to the site theme"
						onclick={() => {
							current[field.key] = undefined;
							onchange();
						}}
					>
						Theme
					</button>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="inspector-empty">
		<div aria-hidden="true">✧</div>
		<h3>Nothing selected</h3>
		<p>Select a block on your canvas to edit its content and style.</p>
	</div>
{/if}

<style>
	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.panel-heading h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}

	.panel-hint {
		margin: 0.8rem 0 1.15rem;
		color: var(--muted, #898ba0);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	.inspector-heading {
		margin-bottom: 1.2rem;
	}

	.inspector-actions {
		display: flex;
		gap: 0.2rem;
	}

	.inspector-actions button:focus-visible {
		outline: 2px solid #8d7cff;
		outline-offset: 2px;
	}

	.icon-button {
		display: grid;
		width: 32px;
		height: 30px;
		place-items: center;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #9697a9;
		cursor: pointer;
	}

	.icon-button svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}

	.delete-button {
		border: 1px solid transparent;
		color: #a1a1b1;
	}

	.delete-button:hover {
		border-color: #f2dada;
		background: #fff5f5;
		color: #cf5c67;
	}

	.selected-component {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1.35rem;
		padding: 0.7rem;
		border: 1px solid #efedf7;
		border-radius: 9px;
		background: #fcfbff;
	}

	.selected-component > div {
		display: grid;
		min-width: 0;
		gap: 0.2rem;
	}

	.selected-component strong {
		overflow: hidden;
		font-size: 0.73rem;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selected-component small {
		overflow: hidden;
		color: var(--muted, #898ba0);
		font-size: 0.62rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.component-mark {
		display: grid;
		width: 32px;
		height: 32px;
		flex: 0 0 32px;
		place-items: center;
		border-radius: 9px;
		background: #f1efff;
		color: var(--purple, #6b5ce7);
		font-size: 1rem;
		font-weight: 700;
	}

	.edit-composite {
		display: inline-block;
		margin-bottom: 0.75rem;
	}

	.text-button {
		padding: 0.3rem 0;
		border: 0;
		background: transparent;
		color: #7a70c4;
		font-size: 0.67rem;
		font-weight: 600;
		cursor: pointer;
	}

	.field-label {
		display: block;
		margin: 0.85rem 0 0.4rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
	}

	.link-group {
		min-width: 0;
		margin: 1rem 0 0;
		padding: 0 0 0.2rem;
		border: 0;
		border-top: 1px solid #eeeef3;
	}

	.link-group legend {
		padding: 0 0.4rem 0 0;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.62rem;
	}

	.link-group .panel-hint {
		margin: 0.4rem 0 0;
	}

	.layer-buttons {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.layer-buttons button {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: 1px solid #d8d4cc;
		border-radius: 6px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.position-hint {
		margin: 0.55rem 0 0.2rem;
		color: var(--muted, #898ba0);
		font-size: 0.62rem;
		line-height: 1.5;
	}

	.position-fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.15rem 0.6rem;
	}

	.widget-state-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.85rem;
		color: #686a80;
		font-size: 0.67rem;
		font-weight: 650;
	}

	.widget-state-control input {
		accent-color: #6b5ce7;
	}

	.field-control {
		display: block;
		width: 100%;
		min-height: 37px;
		padding: 0.55rem 0.65rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.7rem;
		outline: none;
	}

	.field-control:focus {
		border-color: #978be9;
		box-shadow: 0 0 0 3px rgb(119 102 223 / 12%);
	}

	.field-textarea {
		min-height: 94px;
		resize: vertical;
		line-height: 1.5;
	}

	.check-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}

	.route-error {
		color: #b3261e;
		font-size: 0.75rem;
	}

	.field-divider {
		height: 1px;
		margin: 1.3rem 0 1rem;
		background: #eeeef3;
	}

	.color-options {
		display: grid;
		gap: 0.45rem;
	}

	.color-field {
		display: grid;
		grid-template-columns: 5.5rem 2.2rem 1fr auto;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		color: #4b4d63;
	}

	.color-field input[type='color'] {
		width: 2.2rem;
		height: 1.7rem;
		padding: 0;
		border: 1px solid #e3e3ea;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
	}

	.color-field code {
		color: #88869f;
		font-size: 0.65rem;
	}

	.color-reset {
		padding: 0.2rem 0.5rem;
		border: 1px solid #ececf1;
		border-radius: 6px;
		background: #fff;
		color: #6253ca;
		font-size: 0.62rem;
		cursor: pointer;
	}

	.color-reset:disabled {
		color: #c1c1cc;
		cursor: default;
	}

	.image-select-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.35rem;
	}

	.image-browse-toggle {
		flex-shrink: 0;
		min-height: 37px;
		padding: 0.45rem 0.65rem;
		border: 1px solid #d8d4ee;
		border-radius: 7px;
		background: #f8f6ff;
		color: #5b4dc7;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 600;
		cursor: pointer;
	}

	.image-browse-toggle:hover {
		background: #efebff;
	}

	.picked-image-preview {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.5rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid #eceaf6;
		border-radius: 8px;
		background: #fbfaff;
	}

	.picked-image-preview img {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: 6px;
		background: #fff;
		object-fit: contain;
	}

	.picked-image-meta {
		display: grid;
		min-width: 0;
		flex: 1;
		gap: 0.1rem;
	}

	.picked-image-meta strong {
		overflow: hidden;
		font-size: 0.68rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picked-image-meta code {
		overflow: hidden;
		color: #88869f;
		font-size: 0.6rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.image-browser-popover {
		margin-top: 0.55rem;
		padding: 0.55rem;
		border: 1px solid #e6e4f2;
		border-radius: 9px;
		background: #faf9fe;
	}

	.image-browser-filters {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}

	.image-picker-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.35rem;
		max-height: 210px;
		overflow-y: auto;
		padding: 0.15rem;
	}

	.image-picker-tile {
		display: grid;
		justify-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.25rem;
		border: 1px solid #e9e7f3;
		border-radius: 7px;
		background: #fff;
		color: #33354a;
		font: inherit;
		font-size: 0.6rem;
		text-align: center;
		cursor: pointer;
	}

	.image-picker-tile:hover {
		border-color: #b7adfa;
		background: #f6f4ff;
	}

	.image-picker-tile.active {
		border-color: #6b5ce7;
		background: #f0edff;
		box-shadow: 0 0 0 2px rgb(107 92 231 / 18%);
	}

	.image-picker-tile img {
		width: 28px;
		height: 28px;
		object-fit: contain;
	}

	.image-picker-tile span {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.image-picker-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.35rem;
	}

	.inspector-empty {
		display: grid;
		justify-items: center;
		padding: 3rem 0.5rem;
		text-align: center;
	}

	.inspector-empty > div {
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		border-radius: 15px;
		background: #f0edff;
		color: var(--purple, #6b5ce7);
		font-size: 1.5rem;
	}

	.inspector-empty h3 {
		margin: 0.9rem 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 680;
	}

	.inspector-empty p {
		max-width: 290px;
		margin: 0;
		color: #898a9a;
		font-size: 0.73rem;
		line-height: 1.6;
	}

	@media (max-width: 1050px) {
		.inspector-content {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 1rem;
		}

		.selected-component,
		.field-divider,
		.color-options,
		.link-group {
			grid-column: 1 / -1;
		}

		.inspector-content .field-label:first-of-type {
			grid-column: 1;
		}
	}

	@media (max-width: 700px) {
		.inspector-content {
			display: block;
		}

		.inspector-content .field-label:first-of-type {
			grid-column: auto;
		}
	}
</style>
