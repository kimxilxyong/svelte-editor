<script lang="ts">
	/**
	 * @component ImagePicker
	 *
	 * An inline, searchable chooser for the images supplied by the active project. It owns only
	 * disclosure and search state: selecting an image reports its URL to the caller, which owns
	 * the edited value, dirty state and history. No network request or persistence happens here.
	 *
	 * @prop {ProjectImage[]} [images=[]] - Project library entries to offer; not bindable.
	 * @prop {string} [value=''] - Current URL, used to identify the selected image; not bindable.
	 * @prop {string} [label='Choose an image'] - Accessible description of the destination field.
	 * @prop {number} [maxLength=2048] - Maximum selectable URL length for the destination.
	 * @prop {(url: string) => boolean} [accept] - Optional destination-specific URL constraint.
	 * @prop {(url: string) => void} onselect - Called once when an image is chosen.
	 */
	import type { ProjectImage } from '../image-types.js';

	let {
		images = [],
		value = '',
		label = 'Choose an image',
		maxLength = 2048,
		accept,
		onselect
	}: {
		images?: ProjectImage[];
		value?: string;
		label?: string;
		maxLength?: number;
		accept?: (url: string) => boolean;
		onselect: (url: string) => void;
	} = $props();

	let open = $state(false);
	let search = $state('');
	const searchId = $props.id();
	/** Filtering derives from the current library and query; no copy of either becomes stale. */
	const filtered = $derived.by(() => {
		const query = search.trim().toLocaleLowerCase();
		return images.filter((image) =>
			`${image.name} ${image.category} ${image.url}`.toLocaleLowerCase().includes(query)
		);
	});
	const hasUnavailable = $derived(
		filtered.some((image) => image.url.length > maxLength || (accept && !accept(image.url)))
	);

	/** Close the chooser after selection; the owner decides whether the value actually changed. */
	function choose(url: string, button: HTMLButtonElement) {
		const summary = button.closest('details')?.querySelector('summary');
		onselect(url);
		open = false;
		summary?.focus();
	}
</script>

<details class="image-picker" bind:open>
	<summary>{label}</summary>
	<div class="picker-content">
		{#if images.length === 0}
			<p class="message">No images in this project’s library.</p>
		{:else}
			<label class="search-label" for="{searchId}-search">Search images</label>
			<input
				id="{searchId}-search"
				class="search"
				type="search"
				placeholder="Name, category or URL"
				bind:value={search}
			/>
			{#if filtered.length === 0}
				<p class="message">No images match your search.</p>
			{:else}
				<ul class="image-list" aria-label="Project images">
					{#each filtered as image (image.id)}
						{@const disabled = image.url.length > maxLength || (accept && !accept(image.url))}
						<li>
							<button
								type="button"
								class:selected={image.url === value}
								aria-pressed={image.url === value}
								{disabled}
								title={disabled ? 'This image URL cannot be used in this field.' : image.url}
								onclick={(event) => choose(image.url, event.currentTarget)}
							>
								<img src={image.url} alt="" loading="lazy" />
								<span><strong>{image.name}</strong><small>{image.category}</small></span>
							</button>
						</li>
					{/each}
				</ul>
				{#if hasUnavailable}
					<p class="message">Unavailable images do not fit this field’s URL requirements.</p>
				{/if}
			{/if}
		{/if}
	</div>
</details>

<style>
	.image-picker {
		min-width: 0;
		margin-top: 0.4rem;
		color: #4b4d63;
		font-size: 0.7rem;
	}

	summary {
		width: fit-content;
		max-width: 100%;
		color: #6253ca;
		font-weight: 650;
		overflow-wrap: anywhere;
		cursor: pointer;
	}

	summary:focus-visible,
	button:focus-visible,
	.search:focus-visible {
		outline: 2px solid #6b5ce7;
		outline-offset: 2px;
	}

	.picker-content {
		margin-top: 0.45rem;
		padding: 0.55rem;
		border: 1px solid #e7e7ee;
		border-radius: 7px;
		background: #fff;
	}

	.search-label {
		display: block;
		margin-bottom: 0.3rem;
		font-weight: 650;
	}

	.search {
		box-sizing: border-box;
		width: 100%;
		padding: 0.45rem;
		border: 1px solid #d5d5df;
		border-radius: 6px;
		color: #33354a;
		font: inherit;
	}

	.image-list {
		display: grid;
		max-height: 15rem;
		gap: 0.25rem;
		overflow-y: auto;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	button {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	button:hover:not(:disabled),
	button.selected {
		border-color: #d7d1ff;
		background: #f7f5ff;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	img {
		width: 2.5rem;
		height: 2.5rem;
		flex: 0 0 2.5rem;
		border-radius: 4px;
		background: #f1f0f5;
		object-fit: contain;
	}

	button span {
		display: grid;
		min-width: 0;
		gap: 0.15rem;
	}

	strong,
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	small,
	.message {
		color: #686a80;
		font-size: 0.65rem;
	}

	.message {
		margin: 0.45rem 0 0;
		line-height: 1.4;
	}
</style>
