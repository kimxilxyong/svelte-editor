<script lang="ts">
	/**
	 * @fileoverview `/editor` – the page canvas. A thin wrapper around the shared
	 * `SiteEditor` in `pages` mode; see that component for the behaviour.
	 */
	import SiteEditor from '../../lib/components/SiteEditor.svelte';
</script>

<SiteEditor mode="pages" />
