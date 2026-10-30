<script lang="ts">
	/**
	 * @fileoverview `/composites` – the Composite Component canvas. A thin wrapper around the
	 * shared `SiteEditor` in `composites` mode, so composites are edited exactly like pages.
	 */
	import SiteEditor from '../../lib/components/SiteEditor.svelte';
</script>

<SiteEditor mode="composites" />
