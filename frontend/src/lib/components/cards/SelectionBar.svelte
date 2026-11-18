<!--
	Floating bar for the checked tiles: the count, Select all, Move to, Add to
	deck, Re-sort, Export, Delete and Clear. Actions touch the copies in the
	current scope, the ones the tiles' owned badges count.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { getDisplayName, Modal, type InventoryCard } from '#lib';
	import AddToDeckModal from '#lib/components/AddToDeckModal.svelte';
	import CardListExportModal from '#lib/components/CardListExportModal.svelte';
	import { printingExportLines, type CardListExportChoice } from '#lib/utils/card-list-export.ts';
	import type { AddToDeckCard } from '#lib/utils/deck-add.ts';
	import {
		Check,
		CheckCheck,
		ClipboardCopy,
		LayersPlus,
		RefreshCw,
		Trash2,
		X
	} from '@lucide/svelte';
	import MoveMenu from './MoveMenu.svelte';
	import { plural } from './format';
	import { ui } from './live.svelte';
	import { locationName, ownedCount, scopeRows } from './owned';
	import type { CardsView } from './view.svelte';
	import { deleteCopies, moveCopies, refreshCards, resortCopies } from './writes';

	let { view }: { view: CardsView } = $props();

	let running = $state(false);
	let confirmingDelete = $state(false);
	let addingToDeck = $state(false);
	let exporting = $state(false);

	const cards = $derived(view.checkedCards);
	const inCollection = $derived(view.source === 'collection');

	const copiesOf = (card: InventoryCard) =>
		scopeRows(card, view.location).reduce((sum, r) => sum + r.quantity, 0);

	/** Copies the actions would touch; in All cards only the owned ones. */
	const copies = $derived(cards.reduce((sum, c) => sum + copiesOf(c), 0));
	const ownedCards = $derived(cards.filter((c) => copiesOf(c) > 0));
	const allChecked = $derived(cards.length === view.results.length);

	const countTip = $derived(
		[
			plural(cards.length, 'printing', 'printings'),
			inCollection || copies > 0
				? plural(
						copies,
						inCollection ? 'copy' : 'owned copy',
						inCollection ? 'copies' : 'owned copies'
					)
				: ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	// The Move menu leaves out where the copies already are in a one-location scope.
	const current = $derived(
		typeof view.location === 'number'
			? view.location
			: view.location === 'unassigned'
				? null
				: undefined
	);
	const scopeName = $derived(
		view.location === 'all'
			? 'your collection'
			: locationName(view.locations, view.location === 'unassigned' ? null : view.location)
	);
	const deleteWhat = $derived(
		ownedCards.length === 1
			? `${plural(copies, 'copy', 'copies')} of ${getDisplayName(ownedCards[0])}`
			: `${plural(copies, 'copy', 'copies')} of ${ownedCards.length} printings`
	);

	// Collection scopes offer "All selected (N)" or "1 of each"; All cards adds a
	// quantity of each card, owned or not.
	const deckCards = $derived<AddToDeckCard[]>(
		cards.map((c) => ({
			oracle_id: c.oracle_id,
			scryfall_id: c.id,
			name: getDisplayName(c),
			set_name: c.set_name,
			image_uri: c.image_uri,
			copies: inCollection ? copiesOf(c) : 1
		}))
	);

	// Export lines use the English Oracle name (full "Front // Back"), which Cardmarket
	// matches, not the printed name in the page's language. Collection scopes offer the
	// copies in scope or 1 of each, like Add to deck; All cards exports 1 of each.
	const exportChoices = $derived.by<CardListExportChoice[]>(() => {
		const lines = (quantity: (card: InventoryCard) => number) =>
			printingExportLines(
				cards.map((c) => ({ name: c.name, expansion: c.set_name, quantity: quantity(c) }))
			);
		const oneOfEach = { label: '1 of each', export: lines(() => 1) };
		return inCollection
			? [{ label: `All selected (${copies})`, export: lines(copiesOf) }, oneOfEach]
			: [oneOfEach];
	});

	// While a dialog is open, Esc closes it, not the selection or the detail panel.
	// The counter is written untracked: reading it here would re-run this effect.
	const dialogOpen = $derived(confirmingDelete || addingToDeck || exporting);
	$effect(() => {
		if (!dialogOpen) return;
		untrack(() => ui.openPopovers++);
		return () => untrack(() => ui.openPopovers--);
	});

	// The Add-to-deck dialog closes itself on Esc, and skips an Esc handled inside it.
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		exporting = false;
		if (!running) confirmingDelete = false;
	}

	/** Runs an action on the checked cards; the selection clears once it succeeds. */
	async function run(action: (picked: InventoryCard[]) => Promise<boolean | undefined>) {
		if (running) return;
		running = true;
		try {
			if ((await action(cards)) === true) view.clearChecks();
		} finally {
			running = false;
		}
	}

	function move(to: number | null) {
		run((picked) => moveCopies(picked, view.location, to, view.locations));
	}

	async function confirmDelete() {
		await run((picked) => deleteCopies(picked, view.location));
		confirmingDelete = false;
	}

	function onDeckAdded() {
		const picked = cards;
		view.clearChecks();
		refreshCards(picked);
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if view.selecting}
	<div
		class="fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-primary/40 bg-base-200 p-1.5 shadow-2xl"
		role="toolbar"
		aria-label="Selected cards"
		transition:fly={{ y: 16, duration: 180 }}>
		<span
			class="badge badge-primary h-7 gap-1 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap tabular-nums"
			title={countTip}>
			{#if running}
				<span class="loading loading-spinner loading-xs"></span>
			{:else}
				<Check class="size-3.5" strokeWidth={3} aria-hidden="true" />
			{/if}
			{cards.length}<span class="max-sm:sr-only">&nbsp;selected</span>
		</span>
		{#if !allChecked}
			<button
				type="button"
				class="btn btn-ghost btn-sm rounded-full whitespace-nowrap"
				title="Select all"
				aria-label="Select all"
				onclick={() => view.checkAll()}>
				<CheckCheck class="size-4 sm:hidden" />
				<span class="hidden sm:inline">Select all</span>
			</button>
		{/if}

		<div class="mx-1 h-5 w-px shrink-0 bg-base-content/15"></div>

		<MoveMenu
			locations={view.locations}
			{current}
			label="Move selected copies"
			text="Move to"
			top
			disabled={running || copies === 0}
			onMove={move} />
		<button
			type="button"
			class="btn btn-ghost btn-sm rounded-full"
			title="Add to deck"
			aria-label="Add selected cards to a deck"
			disabled={running}
			onclick={() => (addingToDeck = true)}>
			<LayersPlus class="size-4" />
			<span class="hidden sm:inline">Add to deck</span>
		</button>
		<button
			type="button"
			class="btn btn-ghost btn-sm rounded-full"
			title="Re-sort with the sorting rules"
			aria-label="Re-sort selected copies with the sorting rules"
			disabled={running || copies === 0}
			onclick={() => run((picked) => resortCopies(picked, view.location))}>
			<RefreshCw class="size-4" />
			<span class="hidden sm:inline">Re-sort</span>
		</button>
		<button
			type="button"
			class="btn btn-ghost btn-sm rounded-full"
			title="Export card list"
			aria-label="Export selected cards"
			disabled={running}
			onclick={() => (exporting = true)}>
			<ClipboardCopy class="size-4" />
			<span class="hidden sm:inline">Export</span>
		</button>
		<button
			type="button"
			class="btn btn-ghost btn-sm rounded-full text-error"
			title="Delete"
			aria-label="Delete selected copies"
			disabled={running || copies === 0}
			onclick={() => (confirmingDelete = true)}>
			<Trash2 class="size-4" />
			<span class="hidden sm:inline">Delete</span>
		</button>
		<button
			type="button"
			class="btn btn-circle btn-ghost btn-sm"
			title="Clear selection (Esc)"
			aria-label="Clear selection"
			onclick={() => view.clearChecks()}>
			<X class="size-4" />
		</button>
	</div>
{/if}

<Modal
	open={confirmingDelete}
	onClose={() => {
		if (!running) confirmingDelete = false;
	}}
	title="Delete copies"
	boxClass="max-w-sm">
	<p>Delete {deleteWhat} from {scopeName}? This can't be undone.</p>
	{#snippet actions()}
		<button
			type="button"
			class="btn btn-ghost"
			disabled={running}
			onclick={() => (confirmingDelete = false)}>
			Cancel
		</button>
		<button type="button" class="btn btn-error" disabled={running} onclick={confirmDelete}>
			{#if running}<span class="loading loading-spinner loading-xs"></span>{/if}
			Delete
		</button>
	{/snippet}
</Modal>

{#if addingToDeck}
	<AddToDeckModal
		open
		bulk={inCollection}
		cards={deckCards}
		pinByDefault={cards.length > 0 && cards.every((c) => ownedCount(c) > 0)}
		onClose={() => (addingToDeck = false)}
		onAdded={onDeckAdded} />
{/if}

{#if exporting}
	<CardListExportModal
		open
		pinnable
		title="Export selected cards"
		choices={exportChoices}
		onClose={() => (exporting = false)} />
{/if}
