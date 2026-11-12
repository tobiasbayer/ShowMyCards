<!--
	PROTOTYPE. Floating bar for the checked tiles: the count, Select all, Move to,
	Add to deck, Re-sort, Delete and Clear. Actions touch the copies in the
	current scope, the ones the tiles' owned badges count. It floats above the
	prototype switcher pill.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getDisplayName, Modal, type EnhancedCardResult } from '$lib';
	import AddToDeckModal from '$lib/components/AddToDeckModal.svelte';
	import type { AddToDeckCard } from '$lib/utils/deck-add';
	import { LayersPlus, RefreshCw, Trash2, X } from '@lucide/svelte';
	import MoveMenu from './MoveMenu.svelte';
	import {
		deleteCopies,
		locationName,
		moveCopies,
		refreshCards,
		resortCopies,
		scopeRows,
		ui,
		type CardsView
	} from './state.svelte';

	let { view }: { view: CardsView } = $props();

	let running = $state(false);
	let confirmingDelete = $state(false);
	let addingToDeck = $state(false);

	const cards = $derived(view.checkedCards);
	const inCollection = $derived(view.source === 'collection');

	const copiesOf = (card: EnhancedCardResult) =>
		scopeRows(card, view.location).reduce((sum, r) => sum + r.quantity, 0);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

	// While a dialog is open, Esc closes it, not the selection or the detail panel.
	// The counter is written untracked: reading it here would re-run this effect.
	const dialogOpen = $derived(confirmingDelete || addingToDeck);
	$effect(() => {
		if (!dialogOpen) return;
		untrack(() => ui.openPopovers++);
		return () => untrack(() => ui.openPopovers--);
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || running) return;
		confirmingDelete = false;
		addingToDeck = false;
	}

	/** Runs an action on the checked cards; the selection clears once it succeeds. */
	async function run(action: (picked: EnhancedCardResult[]) => Promise<boolean | undefined>) {
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
		class="fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-base-300 bg-base-100 py-1.5 pr-1.5 pl-4 shadow-xl"
		role="toolbar"
		aria-label="Selected cards">
		<span class="text-sm font-medium whitespace-nowrap tabular-nums" title={countTip}>
			{cards.length} selected
		</span>
		{#if running}
			<span class="loading loading-spinner loading-xs ml-1 opacity-50"></span>
		{/if}
		{#if !allChecked}
			<button
				type="button"
				class="btn btn-ghost btn-sm rounded-full whitespace-nowrap"
				onclick={() => view.checkAll()}>
				Select all
			</button>
		{/if}

		<div class="mx-1 h-5 w-px shrink-0 bg-base-300"></div>

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
		onClose={() => (addingToDeck = false)}
		onAdded={onDeckAdded} />
{/if}
