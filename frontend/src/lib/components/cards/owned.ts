// What the Cards page shows about a card's copies: its stacks (re-read after a
// write, else as loaded), the copies in a scope, and where new copies would go.

import type { EnhancedCardResult, Inventory, StorageLocation } from '$lib';
import { live } from './live.svelte';
import {
	aggregateStacks,
	inLocation,
	rowsInLocation,
	type LocationFilter,
	type Stack
} from './stacks';

/** The printing's rows: re-read after a write, else as loaded. */
export function currentRows(card: EnhancedCardResult): Inventory[] {
	return live.rows[card.id] ?? card.inventory.this_printing;
}

export function effectiveStacks(card: EnhancedCardResult): Stack[] {
	return aggregateStacks(currentRows(card));
}

/** The card's rows holding copies in the scope: what a bulk action touches. */
export function scopeRows(card: EnhancedCardResult, filter: LocationFilter): Inventory[] {
	return rowsInLocation(currentRows(card), filter);
}

export function matchesLocation(stack: Pick<Stack, 'locationId'>, filter: LocationFilter): boolean {
	return inLocation(stack.locationId, filter);
}

export function ownedCount(card: EnhancedCardResult, filter: LocationFilter = 'all'): number {
	return effectiveStacks(card)
		.filter((s) => matchesLocation(s, filter))
		.reduce((sum, s) => sum + s.quantity, 0);
}

/** The finishes of this printing's copies in the scope, which price it in a price sort. */
export function ownedFinishes(card: EnhancedCardResult, filter: LocationFilter = 'all'): string[] {
	return effectiveStacks(card)
		.filter((s) => s.quantity > 0 && matchesLocation(s, filter))
		.map((s) => s.finish);
}

export function ownsOtherPrinting(card: EnhancedCardResult): boolean {
	return card.inventory.other_printings.some((row) => row.quantity > 0);
}

/**
 * Where "next to existing copies" points: the location holding the most copies
 * of this printing, else of any other printing. `undefined` when nothing is owned.
 */
export function existingLocation(card: EnhancedCardResult): number | null | undefined {
	const tally = new Map<number | null, number>();
	const own = effectiveStacks(card);
	if (own.length > 0) {
		for (const s of own) tally.set(s.locationId, (tally.get(s.locationId) ?? 0) + s.quantity);
	} else {
		for (const row of card.inventory.other_printings) {
			const id = row.storage_location_id ?? null;
			tally.set(id, (tally.get(id) ?? 0) + row.quantity);
		}
	}
	let best: number | null | undefined;
	let bestCount = 0;
	for (const [id, count] of tally) {
		if (count > bestCount) {
			best = id;
			bestCount = count;
		}
	}
	return best;
}

export function locationName(locations: StorageLocation[], id: number | null): string {
	if (id === null) return 'Unassigned';
	return locations.find((l) => l.id === id)?.name ?? `Location ${id}`;
}

export function finishLabel(finish: string): string {
	return finish.charAt(0).toUpperCase() + finish.slice(1);
}
