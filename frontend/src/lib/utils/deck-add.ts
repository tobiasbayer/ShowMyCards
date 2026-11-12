import type { CreateDeckItemRequest, DeckAvailability, DeckCardUsage, DeckZone } from '$lib';

/** A card offered to the "Add to deck" dialog. */
export interface AddToDeckCard {
	oracle_id: string;
	/** The printing the card came from; only sent when the user pins printings. */
	scryfall_id: string;
	name: string;
	/** Copies available to add (e.g. the selected inventory quantity). */
	copies: number;
	/** Display only: shown in the single-card dialog summary. */
	set_name?: string;
	image_uri?: string;
}

export interface BuildDeckItemsOptions {
	zone: DeckZone;
	/** Require the exact printing instead of any printing of the card. */
	pin: boolean;
	/** 'copies' sums each group's copies; a number sets that quantity per group. */
	quantity: 'copies' | number;
}

/**
 * Turn dialog cards into deck items, one per deck identity.
 *
 * Deck items are unique on (oracle, printing, treatment, zone). Unpinned items
 * have no printing, so two printings of the same card collapse into a single
 * Oracle-level item; pinned items stay per printing. Grouping here also keeps
 * a single batch free of duplicate keys, which the backend would reject.
 *
 * Treatment is left blank (any finish), matching the deck page's add flow:
 * finish is not part of the M1 allocation math.
 */
export function buildDeckItems(
	cards: AddToDeckCard[],
	{ zone, pin, quantity }: BuildDeckItemsOptions
): CreateDeckItemRequest[] {
	const groups = new Map<string, CreateDeckItemRequest>();

	for (const card of cards) {
		const scryfallId = pin ? card.scryfall_id : '';
		const key = `${card.oracle_id}|${scryfallId}`;
		const existing = groups.get(key);

		if (existing) {
			if (quantity === 'copies') existing.desired_quantity += card.copies;
			continue;
		}

		groups.set(key, {
			oracle_id: card.oracle_id,
			scryfall_id: scryfallId,
			treatment: '',
			desired_quantity: quantity === 'copies' ? card.copies : quantity,
			zone
		});
	}

	return [...groups.values()].filter((item) => item.desired_quantity >= 1);
}

/** Adding a card would share copies that other decks already want. */
export interface SharedCopyNotice {
	owned: number;
	/** Copies the other decks want, summed over their demand zones. */
	wantedElsewhere: number;
	/** Distinct names of the other decks that want the card. */
	deckNames: string[];
}

export interface SharedCopyTarget {
	/** null: a deck not created yet, so every deck wanting the card is another deck. */
	deckId: number | null;
	zone: DeckZone;
	quantity: number;
}

/**
 * Decide whether adding `quantity` copies of a card to a deck would take copies
 * that other decks already want, so the owned copies could not build them all.
 *
 * Returns null, meaning nothing to warn about, when
 * - the card goes to the maybe board (not committed demand);
 * - none are owned (plain shortfall, which the deck's own summary reports);
 * - enough copies are still free for the new quantity; or
 * - no other deck wants the card (the committed copies are this deck's own).
 *
 * `usage` is the card's deck items from `/decks/for-card`: any-printing items
 * plus items pinned to this printing. A deck that pinned a different printing of
 * the same card is not listed there, so that conflict is not flagged here; the
 * deck page still shows it.
 */
export function sharedCopyNotice(
	availability: DeckAvailability,
	usage: DeckCardUsage[],
	{ deckId, zone, quantity }: SharedCopyTarget
): SharedCopyNotice | null {
	if (zone === 'maybe') return null;
	if (availability.owned <= 0 || quantity <= availability.free) return null;

	const elsewhere = usage.filter((u) => u.deck_id !== deckId && u.zone !== 'maybe');
	if (elsewhere.length === 0) return null;

	return {
		owned: availability.owned,
		wantedElsewhere: elsewhere.reduce((sum, u) => sum + u.desired_quantity, 0),
		deckNames: [...new Set(elsewhere.map((u) => u.deck_name))]
	};
}

function listNames(names: string[]): string {
	return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
}

/** The sentence shown in the Add-to-deck dialog for a shared-copy notice. */
export function sharedCopyMessage({ owned, wantedElsewhere, deckNames }: SharedCopyNotice): string {
	return (
		`You own ${owned} ${owned === 1 ? 'copy' : 'copies'} and ` +
		`${wantedElsewhere} ${wantedElsewhere === 1 ? 'is' : 'are'} already in ${listNames(deckNames)}. ` +
		`Adding it here means they can't all be built at once.`
	);
}

/** The toast shown after adding a card that shares copies with other decks. */
export function sharedCopyAddedMessage(
	added: string,
	{ deckNames }: Pick<SharedCopyNotice, 'deckNames'>
): string {
	return `${added}. It's also wanted by ${listNames(deckNames)}; you don't own enough copies for all of them.`;
}
