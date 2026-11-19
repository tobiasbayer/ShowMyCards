<script lang="ts">
	import { untrack } from 'svelte';
	import {
		decksApi,
		inventoryApi,
		notifications,
		type DeckAvailability,
		type DeckCardUsage,
		type DeckZone
	} from '#lib';
	import {
		buildDeckItems,
		sharedCopyAddedMessage,
		sharedCopyMessage,
		sharedCopyNotice,
		type AddToDeckCard
	} from '#lib/utils/deck-add.ts';
	import { Info, LayersPlus } from '@lucide/svelte';
	import { DeckChoice } from './deck-choice.svelte';
	import DeckField from './DeckField.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		open: boolean;
		/** Cards to add. A single card gets a quantity input; bulk gets a copies toggle. */
		cards: AddToDeckCard[];
		/** Bulk mode (inventory selection): offer "all selected copies" vs "1 of each". */
		bulk?: boolean;
		/** Start with "Pin this printing" ticked (the caller adds printings the user owns). */
		pinByDefault?: boolean;
		onClose: () => void;
		onAdded?: (deckName: string) => void;
	}

	let { open, cards, bulk = false, pinByDefault = false, onClose, onAdded }: Props = $props();

	const uid = $props.id();

	const ZONES: { value: DeckZone; label: string }[] = [
		{ value: 'command', label: 'Command' },
		{ value: 'main', label: 'Main' },
		{ value: 'side', label: 'Side' },
		{ value: 'maybe', label: 'Maybe' }
	];

	// Tokens and other extras are stored in Other whatever zone was picked, so the
	// success message names the zones the server reports, not the picked one.
	function storedZonesLabel(stored: string[]): string {
		const zones = stored.length > 0 ? stored : [zone];
		return zones
			.map((z) => ZONES.find((o) => o.value === z)?.label ?? (z === 'other' ? 'Other' : z))
			.join(', ');
	}
	let zone = $state<DeckZone>('main');
	let qty = $state(1);
	let copiesMode = $state<'copies' | 'one'>('copies');
	let pin = $state(false);
	let saving = $state(false);

	const choice = new DeckChoice();

	const totalCopies = $derived(cards.reduce((sum, c) => sum + c.copies, 0));
	const single = $derived(!bulk && cards.length === 1 ? cards[0] : null);
	const previewNames = $derived(cards.slice(0, 3).map((c) => c.name));
	const canSubmit = $derived(
		choice.hasTarget && cards.length > 0 && !saving && (bulk || (Number.isInteger(qty) && qty >= 1))
	);

	// Advisory only: how many copies of the card are free and which decks already
	// want it. This depends on the card alone, so the notice below reacts to the
	// chosen deck, zone and quantity without refetching. Single-card mode only.
	let copyInfo = $state<{ availability: DeckAvailability; usage: DeckCardUsage[] } | null>(null);
	const infoOracleId = $derived(open && single ? single.oracle_id : '');
	const infoPrintingId = $derived(open && single ? single.scryfall_id : '');

	$effect(() => {
		const oracleId = infoOracleId;
		const printingId = infoPrintingId;
		copyInfo = null;
		if (!oracleId || !printingId) return;

		let stale = false;
		Promise.all([inventoryApi.availability(oracleId), decksApi.forCard(printingId)])
			.then(([availability, usage]) => {
				if (!stale) copyInfo = { availability, usage };
			})
			.catch(() => {
				// The notice is a courtesy: a failed lookup never blocks adding.
			});
		return () => {
			stale = true;
		};
	});

	// A deck still being named has no items, so every deck wanting the card is another deck.
	const targetDeckId = $derived(choice.targetId);
	const sharedCopies = $derived(
		copyInfo && targetDeckId !== undefined && Number.isInteger(qty) && qty >= 1
			? sharedCopyNotice(copyInfo.availability, copyInfo.usage, {
					deckId: targetDeckId,
					zone,
					quantity: qty
				})
			: null
	);

	$effect(() => {
		if (open)
			untrack(() => {
				pin = pinByDefault;
				choice.load();
			});
	});

	// Esc closes the dialog, unless something inside handled it (the new-deck name
	// cancels "New"; an open dropdown takes Esc before it gets here).
	function onKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape' && !e.defaultPrevented && !saving) onClose();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;

		const items = buildDeckItems(cards, {
			zone,
			pin,
			quantity: bulk ? (copiesMode === 'copies' ? 'copies' : 1) : qty
		});
		if (items.length === 0) return;

		// Captured now: the notice follows the form, which may change while saving.
		const sharedWith = sharedCopies;

		saving = true;
		try {
			// A name typed under "New" is the deck meant: it is created first.
			const deck = await choice.target();
			if (!deck) return;

			const storedZones = await decksApi.addItems(deck.id, items);
			choice.remember(deck);
			const zoneLabel = storedZonesLabel(storedZones);
			const added = single
				? `Added ${qty > 1 ? `${qty}× ` : ''}${single.name} to ${deck.name} (${zoneLabel})`
				: `Added ${items.length} card${items.length === 1 ? '' : 's'} to ${deck.name} (${zoneLabel})`;
			if (sharedWith) notifications.warning(sharedCopyAddedMessage(added, sharedWith));
			else notifications.success(added);
			onAdded?.(deck.name);
			onClose();
		} catch (err) {
			notifications.error(err instanceof Error ? err.message : 'Failed to add to deck');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<Modal {open} {onClose} title="Add to deck" boxClass="max-w-md">
	<form onsubmit={submit} class="space-y-5">
		<!-- What is being added -->
		{#if single}
			<div class="flex items-center gap-3 rounded-box bg-base-200 p-2">
				{#if single.image_uri}
					<img src={single.image_uri} alt="" class="w-12 shrink-0 rounded" />
				{/if}
				<div class="min-w-0">
					<div class="truncate font-semibold">{single.name}</div>
					{#if single.set_name}
						<div class="truncate text-sm opacity-70">{single.set_name}</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="rounded-box bg-base-200 p-3">
				<div class="font-semibold">
					{cards.length}
					{cards.length === 1 ? 'card' : 'cards'}
					<!-- Owned copies matter only in bulk mode, where they can set the quantity. -->
					{#if bulk}
						· {totalCopies}
						{totalCopies === 1 ? 'copy' : 'copies'}
					{/if}
					selected
				</div>
				<div class="truncate text-sm opacity-70">
					{previewNames.join(', ')}{cards.length > 3 ? ` +${cards.length - 3} more` : ''}
				</div>
			</div>
		{/if}

		<DeckField {choice} id="{uid}-deck" />

		<!-- Zone -->
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 font-semibold">Zone</legend>
			<div class="join">
				{#each ZONES as z (z.value)}
					<input
						type="radio"
						name="{uid}-zone"
						class="join-item btn btn-sm"
						aria-label={z.label}
						value={z.value}
						bind:group={zone} />
				{/each}
			</div>
		</fieldset>

		<!-- Quantity -->
		{#if bulk}
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-2 font-semibold">Copies</legend>
				<div class="join">
					<input
						type="radio"
						name="{uid}-copies"
						class="join-item btn btn-sm"
						aria-label="All selected ({totalCopies})"
						value="copies"
						bind:group={copiesMode} />
					<input
						type="radio"
						name="{uid}-copies"
						class="join-item btn btn-sm"
						aria-label="1 of each"
						value="one"
						bind:group={copiesMode} />
				</div>
			</fieldset>
		{:else}
			<div class="flex flex-col gap-2">
				<label for="{uid}-qty" class="font-semibold"
					>{single ? 'Quantity' : 'Quantity of each'}</label>
				<input id="{uid}-qty" type="number" min="1" class="input input-sm w-24" bind:value={qty} />
			</div>
		{/if}

		<!-- Pin printing -->
		<label class="flex cursor-pointer items-start gap-3">
			<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={pin} />
			<span class="text-sm">
				<span class="font-medium">Pin {single ? 'this printing' : 'these printings'}</span>
				<span class="block opacity-70">
					Otherwise any printing of the card fills the deck slot.
				</span>
			</span>
		</label>

		{#if sharedCopies}
			<div role="status" class="alert alert-info alert-soft py-2 text-sm">
				<Info class="h-4 w-4 shrink-0" />
				<span>{sharedCopyMessage(sharedCopies)}</span>
			</div>
		{/if}

		<div class="modal-action">
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button type="submit" class="btn btn-primary" disabled={!canSubmit}>
				{#if saving}
					<span class="loading loading-spinner loading-xs"></span>
				{:else}
					<LayersPlus class="h-4 w-4" />
				{/if}
				Add to deck
			</button>
		</div>
	</form>
</Modal>
