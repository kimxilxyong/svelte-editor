<script lang="ts">
	/**
	 * @component CompositeHarness
	 * Test-only wrapper that publishes composites through context and renders one block, so specs
	 * can exercise nested `composite:<Name>` rendering of `BlockContent` without the full editor.
	 *
	 * @prop {BuilderBlock} block - Block to render.
	 * @prop {EditorComposite[]} composites - Composites made available to `composite:` blocks.
	 * @prop {(event: MouseEvent, block: BuilderBlock) => void} [onlink] - Forwarded link handler.
	 * @prop {() => void} [onchange] - Forwarded edit handler.
	 */
	import BlockContent from '../BlockContent.svelte';
	import { provideComposites } from '../../composite-context.js';
	import type { BuilderBlock, EditorComposite } from '../../editor.js';

	let {
		block,
		composites,
		onlink,
		onchange
	}: {
		block: BuilderBlock;
		composites: EditorComposite[];
		onlink?: (event: MouseEvent, block: BuilderBlock) => void;
		onchange?: () => void;
	} = $props();

	provideComposites(() => composites);
</script>

<BlockContent {block} {onlink} {onchange} />
