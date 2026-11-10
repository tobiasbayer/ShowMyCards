<!--
	PROTOTYPE, throwaway. Minimal card tile: image, "Name · SET", a deck badge
	(copies free for decks) and an ownership badge, and a single hover "+" that
	opens the Add popover.
-->
<script lang="ts">
	import { getDisplayName, type EnhancedCardResult } from '$lib';
	import { Layers, Plus } from '@lucide/svelte';
	import AddPopover from './AddPopover.svelte';
	import { ownedCount, ownsOtherPrinting, type CardsView } from './state.svelte';

	let { card, view }: { card: EnhancedCardResult; view: CardsView } = $props();

	let adding = $state(false);

	// In a location-filtered Collection, count only the copies at that location.
	const count = $derived(ownedCount(card, view.source === 'collection' ? view.location : 'all'));
	const otherPrintingOnly = $derived(
		count === 0 && view.source === 'catalog' && ownsOtherPrinting(card)
	);
	const isSelected = $derived(view.selected?.id === card.id);
	const name = $derived(getDisplayName(card));
	// Per card, not per printing: decks ask for a card, any printing fills the slot.
	const deck = $derived(view.forDecks(card));
</script>

<div class="group">
	<div class="relative">
		<button
			type="button"
			class="block w-full overflow-hidden rounded-[4.75%/3.4%] bg-base-300 shadow-sm outline-offset-4 transition duration-150
				{isSelected
				? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
				: 'group-hover:-translate-y-0.5 group-hover:shadow-lg'}"
			aria-label="Show details for {name}"
			aria-pressed={isSelected}
			onclick={() => view.select(card)}>
			{#if card.image_uri}
				<img
					src={card.image_uri}
					alt=""
					loading="lazy"
					class="aspect-[488/680] w-full object-cover" />
			{:else}
				<div class="grid aspect-[488/680] place-items-center p-3 text-center text-sm">
					{name}
				</div>
			{/if}
		</button>

		{#if !adding}
			<button
				type="button"
				class="btn btn-circle btn-sm absolute right-2 bottom-2 border-0 bg-base-100/90 shadow-md backdrop-blur
					opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				aria-label="Add {name} to collection"
				title="Add to collection"
				onclick={() => (adding = true)}>
				<Plus class="size-4" />
			</button>
		{:else}
			<div class="absolute inset-x-1.5 bottom-1.5 z-20">
				<AddPopover {card} {view} onClose={() => (adding = false)} />
			</div>
		{/if}
	</div>

	<div class="mt-2 flex items-center gap-1.5 px-0.5 text-sm leading-tight">
		<span class="truncate font-medium" title={name} lang={card.printed_name ? card.language : 'en'}
			>{name}</span>
		{#if card.set_code}
			<span class="shrink-0 text-xs uppercase text-base-content/40">· {card.set_code}</span>
		{/if}
		<span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
			{#if deck.owned > 0}
				<span
					class="badge badge-sm gap-0.5 rounded-full px-1.5 font-semibold tabular-nums
						{deck.free > 0 ? 'badge-soft badge-success' : 'badge-ghost text-base-content/40'}"
					title={deck.free > 0
						? `${deck.free} free for decks (all printings)`
						: 'All copies are in decks'}>
					<Layers class="size-3" aria-hidden="true" />{deck.free}
				</span>
			{/if}
			{#if count > 0}
				<span
					class="badge badge-primary badge-sm rounded-full px-1.5 font-semibold tabular-nums"
					title="{count} owned">{count}</span>
			{:else if otherPrintingOnly}
				<span
					class="block size-2.5 rounded-full border-[1.5px] border-base-content/35"
					title="You own another printing of this card"
					aria-label="You own another printing of this card"></span>
			{/if}
		</span>
	</div>
</div>
