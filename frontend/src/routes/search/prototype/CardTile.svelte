<!--
	PROTOTYPE, throwaway. Minimal card tile: image, "Name · SET", a deck badge
	(copies of this printing free for decks) and an ownership badge, a hover "+" that opens the
	Add popover, and a hover checkmark that selects the tile for bulk actions.
	While the results are ordered by price, a second line shows the price they are
	ordered by (in the collection, the highest price among the finishes in scope).
	While anything is selected, a click toggles the tile instead of opening the
	panel, Shift-click selects a range, and "+" is hidden.
-->
<script lang="ts">
	import { getDisplayName, type EnhancedCardResult } from '$lib';
	import { highestOwnedPrice, printingPrice } from '$lib/utils/card-prices';
	import { Check, Layers, Plus } from '@lucide/svelte';
	import AddPopover from './AddPopover.svelte';
	import {
		locationName,
		ownedCount,
		ownedFinishes,
		ownsOtherPrinting,
		type CardsView
	} from './state.svelte';

	let { card, view }: { card: EnhancedCardResult; view: CardsView } = $props();

	let adding = $state(false);

	// In a location-filtered Collection, count only the copies at that location.
	const count = $derived(ownedCount(card, view.source === 'collection' ? view.location : 'all'));
	// The number is copies of this printing in the scope the page is showing, so
	// the wording follows the scope (it is only "in this storage" for a location).
	const ownedTip = $derived.by(() => {
		const copies = `${count} ${count === 1 ? 'copy' : 'copies'}`;
		if (view.source !== 'collection' || view.location === 'all')
			return `${copies} in your collection`;
		if (view.location === 'unassigned') return `${copies} not in any storage`;
		return `${copies} in ${locationName(view.locations, view.location)}`;
	});
	const otherPrintingOnly = $derived(
		count === 0 && view.source === 'catalog' && ownsOtherPrinting(card)
	);
	const isSelected = $derived(view.selected?.id === card.id);
	const checked = $derived(view.checked.has(card.id));
	// While selecting, the ring marks checked tiles rather than the panel's card.
	const ringed = $derived(view.selecting ? checked : isSelected);
	const name = $derived(getDisplayName(card));
	// Per printing, so the tile holding a free copy stands out. Never more than the
	// copies the owned badge counts, so a location scope caps it too.
	const free = $derived(Math.min(view.freeForDecks(card), count));

	// The number the results are sorted by, so the tiles read in order; null when
	// they aren't sorted by price.
	const price = $derived.by(() => {
		const cur = view.priceCurrency;
		if (!cur) return null;
		const value =
			view.source === 'collection'
				? highestOwnedPrice(card.prices, ownedFinishes(card, view.location), cur)
				: printingPrice(card.prices, cur);
		return value === undefined ? '—' : `${cur === 'eur' ? '€' : '$'}${value.toFixed(2)}`;
	});
</script>

<div class="group {view.selecting ? 'select-none' : ''}">
	<div class="relative">
		<button
			type="button"
			class="block w-full overflow-hidden rounded-[4.75%/3.4%] bg-base-300 shadow-sm outline-offset-4 transition duration-150
				{ringed
				? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
				: 'group-hover:-translate-y-0.5 group-hover:shadow-lg'}"
			aria-label={view.selecting ? `Select ${name}` : `Show details for ${name}`}
			aria-pressed={ringed}
			onclick={(e) => (view.selecting ? view.toggleCheck(card, e.shiftKey) : view.select(card))}>
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

		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			class="btn btn-circle btn-sm absolute top-2 left-2 shadow-md backdrop-blur transition-opacity
				{checked ? 'btn-primary' : 'border-0 bg-base-100/90 text-base-content/40 hover:text-base-content'}
				{view.selecting ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
			aria-label="Select {name}"
			title={checked ? 'Deselect' : 'Select'}
			onclick={(e) => view.toggleCheck(card, e.shiftKey)}>
			<Check class="size-4" strokeWidth={3} />
		</button>

		{#if adding}
			<div class="absolute inset-x-1.5 bottom-1.5 z-20">
				<AddPopover {card} {view} onClose={() => (adding = false)} />
			</div>
		{:else if !view.selecting}
			<!-- Hidden while selecting, so a stray click can't add a copy. -->
			<button
				type="button"
				class="btn btn-circle btn-sm absolute right-2 bottom-2 border-0 bg-base-100/90 shadow-md backdrop-blur
					opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				aria-label="Add {name} to collection"
				title="Add to collection"
				onclick={() => (adding = true)}>
				<Plus class="size-4" />
			</button>
		{/if}
	</div>

	<div class="mt-2 flex items-center gap-1.5 px-0.5 text-sm leading-tight">
		<span class="truncate font-medium" title={name} lang={card.printed_name ? card.language : 'en'}
			>{name}</span>
		{#if card.set_code}
			<span class="shrink-0 text-xs uppercase text-base-content/40">· {card.set_code}</span>
		{/if}
		<span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
			{#if count > 0}
				<span class="tooltip tooltip-top flex" data-tip="Free for deck building (this printing)">
					<span
						class="badge badge-sm gap-0.5 rounded-full px-1.5 font-semibold tabular-nums
							{free > 0 ? 'badge-soft badge-success' : 'badge-ghost text-base-content/40'}"
						role="img"
						aria-label="Free for deck building (this printing): {free}">
						<Layers class="size-3" aria-hidden="true" />{free}
					</span>
				</span>
			{/if}
			{#if count > 0}
				<span class="tooltip tooltip-left flex" data-tip={ownedTip}>
					<span
						class="badge badge-primary badge-sm rounded-full px-1.5 font-semibold tabular-nums"
						role="img"
						aria-label={ownedTip}>{count}</span>
				</span>
			{:else if otherPrintingOnly}
				<span class="tooltip tooltip-left flex" data-tip="You own another printing of this card">
					<span
						class="block size-2.5 rounded-full border-[1.5px] border-base-content/35"
						role="img"
						aria-label="You own another printing of this card"></span>
				</span>
			{/if}
		</span>
	</div>
	{#if price !== null}
		<div
			class="mt-0.5 px-0.5 text-sm tabular-nums leading-tight {price === '—'
				? 'text-base-content/30'
				: 'text-base-content/70'}"
			title={price === '—' ? 'No price known' : undefined}>
			{price}
		</div>
	{/if}
</div>
