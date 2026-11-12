<!--
	PROTOTYPE, throwaway. Variant "push": the detail panel sits beside the grid;
	the grid narrows and reflows while it is open.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { StorageLocation } from '$lib';
	import CardGrid from './CardGrid.svelte';
	import CardPanel from './CardPanel.svelte';
	import CardsHeader from './CardsHeader.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import { CardsView, ui, type ProtoData } from './state.svelte';

	let { proto, locations }: { proto: ProtoData; locations: StorageLocation[] } = $props();

	const view = untrack(() => new CardsView(proto, locations));

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
				class="sticky top-4 h-[calc(100dvh-6rem)] w-[380px] shrink-0 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm"
				aria-label="Card details"
				transition:fly={{ x: 40, duration: 180 }}>
				<CardPanel card={view.selected} {view} />
			</aside>
		{/if}
	</div>
</div>

<SelectionBar {view} />
