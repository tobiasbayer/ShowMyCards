<!--
	The Cards page: header, card grid and detail panel. From the md breakpoint the
	panel sits beside the grid, which narrows and reflows while it is open; on
	narrower screens it covers the page.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { StorageLocation } from '#lib';
	import CardGrid from './CardGrid.svelte';
	import CardPanel from './CardPanel.svelte';
	import CardsHeader from './CardsHeader.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { ui } from './live.svelte';
	import { CardsView, type CardsPageData } from './view.svelte';

	let { data, locations }: { data: CardsPageData; locations: StorageLocation[] } = $props();

	const view = untrack(() => new CardsView(data, locations));

	// Esc closes an open popover, menu or dialog first (they count themselves in
	// ui.openPopovers), then clears the selection, then closes the panel.
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || ui.openPopovers > 0) return;
		if (view.selecting) view.clearChecks();
		else if (view.selected) view.close();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="mx-auto max-w-[1600px] pb-24">
	<CardsHeader {view} />
	<div class="flex items-start gap-6">
		<div class="min-w-0 flex-1">
			<CardGrid {view} />
		</div>
		{#if view.selected}
			<aside
				class="fixed inset-0 z-40 overflow-hidden bg-base-100
					md:sticky md:inset-auto md:top-4 md:z-auto md:h-[calc(100dvh-6rem)] md:w-95 md:shrink-0
					md:rounded-box md:border md:border-base-300 md:shadow-sm"
				aria-label="Card details"
				transition:fly={{ x: 40, duration: 180 }}>
				<CardPanel card={view.selected} {view} />
			</aside>
		{/if}
	</div>
</div>

<SelectionBar {view} />
