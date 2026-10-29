<script lang="ts">
	/**
	 * @component PageView
	 *
	 * Read-only rendering of a whole {@link EditorPage} using the real section/widget components,
	 * positioned exactly like on the editor canvas (`left`/`width` in %, `top`/`height` in px).
	 * It is what the home page shows for the selected page, so the overview always matches the
	 * editor, and what the home page's Preview mode shows at full size.
	 *
	 * Two independent switches:
	 * - `fit` (default `true`): scale the page down (never up) to the available width, otherwise
	 *   show it at its real pixel width.
	 * - `interactive` (default `false`): when `false` the page is `inert` – an at-a-glance
	 *   overview. When `true` (Preview) widgets and links are usable; the host handles link
	 *   clicks through `onlink`.
	 *
	 * Widget edits (typing, toggling) only affect a local copy of the blocks, never the page
	 * passed in, so previewing can't dirty or modify the site. The copy resets when the page
	 * changes.
	 *
	 * @prop {EditorPage} page - Page to render.
	 * @prop {boolean} [fit=true] - Scale down to the container width.
	 * @prop {boolean} [interactive=false] - Allow using widgets and links (Preview).
	 * @prop {(event: MouseEvent, block: BuilderBlock) => void} [onlink] - Link widget click handler.
	 *
	 * @example
	 * <PageView {page} />
	 * <PageView {page} interactive onlink={followLink} />
	 */
	import BlockContent from './BlockContent.svelte';
	import type { BuilderBlock, EditorPage } from '../editor.js';

	let {
		page,
		fit = true,
		interactive = false,
		onlink
	}: {
		page: EditorPage;
		fit?: boolean;
		interactive?: boolean;
		onlink?: (event: MouseEvent, block: BuilderBlock) => void;
	} = $props();

	// eslint-disable-next-line svelte/prefer-writable-derived
	let blocks = $state<BuilderBlock[]>([]);
	let availableWidth = $state(0);

	// A writable $derived would hold a plain (non-reactive) snapshot, so widget edits made through
	// bind: would not re-render; a deeply reactive $state copy is needed here.
	// Local, disposable copy so interactive widgets can be tried out without touching the site.
	$effect.pre(() => {
		blocks = $state.snapshot(page.blocks) as BuilderBlock[];
	});

	// Same height rule as the editor canvas: tall enough for the lowest block plus a margin.
	const height = $derived(
		Math.max(page.height, ...page.blocks.map((block) => block.y + block.height + 40))
	);
	const scale = $derived(fit && availableWidth > 0 ? Math.min(1, availableWidth / page.width) : 1);
</script>

<div class="page-view" class:fit bind:clientWidth={availableWidth}>
	<div
		class="frame"
		style:width="{page.width * scale}px"
		style:height="{height * scale}px"
		inert={!interactive}
	>
		<div
			class="page"
			style:width="{page.width}px"
			style:min-height="{height}px"
			style:transform={scale === 1 ? undefined : `scale(${scale})`}
			role="region"
			aria-label="Preview of {page.name}"
		>
			{#each blocks as block, index (block.id)}
				<article
					class="block {block.kind} theme-{block.theme}"
					style:left="{block.x}%"
					style:top="{block.y}px"
					style:width="{block.width}%"
					style:height="{block.height}px"
				>
					<BlockContent bind:block={blocks[index]} {onlink} />
				</article>
			{/each}
			{#if blocks.length === 0}
				<p class="empty">This page has no content yet. Use “Edit this page” to add some.</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.page-view {
		width: 100%;
		min-width: 0;
	}

	.frame {
		margin-inline: auto;
	}

	.page {
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 8px 26px rgb(34 34 56 / 0.09);
		transform-origin: top left;
		color: #20233a;
	}

	.block {
		position: absolute;
		z-index: 1;
		overflow: hidden;
		box-sizing: border-box;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 5px 18px rgb(34 34 56 / 0.12);
	}

	.empty {
		margin: 0;
		padding: 3rem 1rem;
		color: #898ba0;
		text-align: center;
	}
</style>
