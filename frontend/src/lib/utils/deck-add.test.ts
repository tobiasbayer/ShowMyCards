import { describe, expect, it } from 'vitest';
import type { DeckAvailability, DeckCardUsage } from '$lib';
import {
	buildDeckItems,
	sharedCopyAddedMessage,
	sharedCopyMessage,
	sharedCopyNotice,
	type AddToDeckCard
} from './deck-add';

function card(oracle: string, printing: string, copies = 1): AddToDeckCard {
	return { oracle_id: oracle, scryfall_id: printing, name: oracle, copies };
}

describe('buildDeckItems', () => {
	it('merges printings of the same card into one any-printing item when unpinned', () => {
		const items = buildDeckItems([card('sol', 'cmm', 2), card('sol', 'c21', 1)], {
			zone: 'main',
			pin: false,
			quantity: 'copies'
		});
		expect(items).toEqual([
			{ oracle_id: 'sol', scryfall_id: '', treatment: '', desired_quantity: 3, zone: 'main' }
		]);
	});

	it('keeps pinned printings as separate items', () => {
		const items = buildDeckItems([card('sol', 'cmm', 2), card('sol', 'c21', 1)], {
			zone: 'side',
			pin: true,
			quantity: 'copies'
		});
		expect(items).toEqual([
			{ oracle_id: 'sol', scryfall_id: 'cmm', treatment: '', desired_quantity: 2, zone: 'side' },
			{ oracle_id: 'sol', scryfall_id: 'c21', treatment: '', desired_quantity: 1, zone: 'side' }
		]);
	});

	it('adds a fixed quantity per group regardless of copies', () => {
		const items = buildDeckItems(
			[card('sol', 'cmm', 4), card('sol', 'c21', 2), card('bolt', 'm10', 3)],
			{ zone: 'main', pin: false, quantity: 1 }
		);
		expect(items.map((i) => [i.oracle_id, i.desired_quantity])).toEqual([
			['sol', 1],
			['bolt', 1]
		]);
	});

	it('sums copies per distinct card', () => {
		const items = buildDeckItems([card('sol', 'cmm', 2), card('bolt', 'm10', 4)], {
			zone: 'main',
			pin: false,
			quantity: 'copies'
		});
		expect(items.map((i) => [i.oracle_id, i.desired_quantity])).toEqual([
			['sol', 2],
			['bolt', 4]
		]);
	});

	it('drops groups with nothing to add', () => {
		const items = buildDeckItems([card('sol', 'cmm', 0)], {
			zone: 'main',
			pin: false,
			quantity: 'copies'
		});
		expect(items).toEqual([]);
	});
});

function usage(deckId: number, deckName: string, quantity = 1, zone = 'main'): DeckCardUsage {
	return {
		deck_id: deckId,
		deck_name: deckName,
		zone,
		desired_quantity: quantity,
		scryfall_id: '',
		treatment: ''
	};
}

function availability(owned: number, free: number): DeckAvailability {
	return { owned, decked: owned - free, free };
}

describe('sharedCopyNotice', () => {
	// The reported case: one copy owned, already wanted by Byrke Commander.
	const oneCopyInByrke = [usage(2, 'Byrke Commander')];

	it('flags a card whose only copy is already wanted by another deck', () => {
		expect(
			sharedCopyNotice(availability(1, 0), oneCopyInByrke, { deckId: 3, zone: 'main', quantity: 1 })
		).toEqual({ owned: 1, wantedElsewhere: 1, deckNames: ['Byrke Commander'] });
	});

	it('stays quiet when enough copies are still free', () => {
		expect(
			sharedCopyNotice(availability(2, 1), oneCopyInByrke, { deckId: 3, zone: 'main', quantity: 1 })
		).toBeNull();
	});

	it('flags the add when the quantity exceeds the free copies', () => {
		expect(
			sharedCopyNotice(availability(2, 1), oneCopyInByrke, { deckId: 3, zone: 'main', quantity: 2 })
		).toMatchObject({ owned: 2, wantedElsewhere: 1 });
	});

	it('stays quiet for a card the user does not own (plain shortfall)', () => {
		expect(
			sharedCopyNotice(availability(0, 0), oneCopyInByrke, { deckId: 3, zone: 'main', quantity: 1 })
		).toBeNull();
	});

	it('stays quiet when only the target deck holds the card', () => {
		expect(
			sharedCopyNotice(availability(1, 0), oneCopyInByrke, { deckId: 2, zone: 'main', quantity: 1 })
		).toBeNull();
	});

	it('stays quiet when adding to the maybe board, which commits no copies', () => {
		expect(
			sharedCopyNotice(availability(1, 0), oneCopyInByrke, {
				deckId: 3,
				zone: 'maybe',
				quantity: 1
			})
		).toBeNull();
	});

	it('ignores other decks that only have the card on their maybe board', () => {
		expect(
			sharedCopyNotice(availability(1, 1), [usage(2, 'Byrke Commander', 1, 'maybe')], {
				deckId: 3,
				zone: 'main',
				quantity: 2
			})
		).toBeNull();
	});

	it('sums demand and de-duplicates deck names across zones and decks', () => {
		const notice = sharedCopyNotice(
			availability(2, 0),
			[
				usage(2, 'Byrke Commander', 1, 'main'),
				usage(2, 'Byrke Commander', 1, 'side'),
				usage(4, 'Elves')
			],
			{ deckId: 3, zone: 'main', quantity: 1 }
		);
		expect(notice).toEqual({
			owned: 2,
			wantedElsewhere: 3,
			deckNames: ['Byrke Commander', 'Elves']
		});
	});
});

describe('sharedCopyMessage', () => {
	it('names the deck for the single-copy case', () => {
		expect(
			sharedCopyMessage({ owned: 1, wantedElsewhere: 1, deckNames: ['Byrke Commander'] })
		).toBe(
			"You own 1 copy and 1 is already in Byrke Commander. Adding it here means they can't all be built at once."
		);
	});

	it('pluralises and joins several deck names', () => {
		expect(
			sharedCopyMessage({ owned: 2, wantedElsewhere: 3, deckNames: ['Byrke Commander', 'Elves'] })
		).toBe(
			"You own 2 copies and 3 are already in Byrke Commander and Elves. Adding it here means they can't all be built at once."
		);
	});
});

describe('sharedCopyAddedMessage', () => {
	it('appends the other decks to what was added', () => {
		expect(
			sharedCopyAddedMessage('Added Salvation Swan to Foo (Main)', {
				deckNames: ['Byrke Commander']
			})
		).toBe(
			"Added Salvation Swan to Foo (Main). It's also wanted by Byrke Commander; you don't own enough copies for all of them."
		);
	});
});
