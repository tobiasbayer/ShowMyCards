// PROTOTYPE. Pure helpers that turn a printing's inventory rows into stacks and
// pick the rows a write should touch. Kept free of Svelte and network code so
// the choices that change real data are unit-tested (stacks.test.ts).

import type { Inventory } from '$lib';

/** Copies of one printing, in one finish, at one location (null = unassigned). */
export interface Stack {
	finish: string;
	locationId: number | null;
	quantity: number;
}

/** A collection scope: every location, unassigned copies, or one location id. */
export type LocationFilter = 'all' | 'unassigned' | number;

const finishOf = (row: Inventory) => row.treatment || 'nonfoil';
const locationOf = (row: Inventory) => row.storage_location_id ?? null;

/** Whether a location (null = unassigned) is in the scope. */
export function inLocation(locationId: number | null, filter: LocationFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'unassigned') return locationId === null;
	return locationId === filter;
}

/** The rows holding copies in the scope: what a bulk action on the card touches. */
export function rowsInLocation(rows: Inventory[], filter: LocationFilter): Inventory[] {
	return rows.filter((row) => row.quantity > 0 && inLocation(locationOf(row), filter));
}

/**
 * The ids from `fromId` to `toId` in display order, both included, for a
 * Shift-click range. Only `toId` when `fromId` is no longer shown.
 */
export function idsBetween(ids: string[], fromId: string, toId: string): string[] {
	const from = ids.indexOf(fromId);
	const to = ids.indexOf(toId);
	if (to === -1) return [];
	if (from === -1) return [toId];
	return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Rows can split one stack; this sums them into one entry per finish and location. */
export function aggregateStacks(rows: Inventory[]): Stack[] {
	const stacks: Stack[] = [];
	for (const row of rows) {
		if (row.quantity <= 0) continue;
		const stack = stacks.find(
			(s) => s.finish === finishOf(row) && s.locationId === locationOf(row)
		);
		if (stack) stack.quantity += row.quantity;
		else
			stacks.push({ finish: finishOf(row), locationId: locationOf(row), quantity: row.quantity });
	}
	return stacks;
}

/** The rows that make up a stack. */
export function rowsOfStack(
	rows: Inventory[],
	stack: Pick<Stack, 'finish' | 'locationId'>
): Inventory[] {
	return rows.filter(
		(row) =>
			row.quantity > 0 && finishOf(row) === stack.finish && locationOf(row) === stack.locationId
	);
}

/**
 * The row "−" takes a copy from: a single-copy row first, because deleting it
 * also shrinks a stack that is split across rows, otherwise the newest row.
 */
export function pickRowToDecrement(
	rows: Inventory[],
	stack: Pick<Stack, 'finish' | 'locationId'>
): Inventory | undefined {
	return rowsOfStack(rows, stack).sort(
		(a, b) => Number(b.quantity === 1) - Number(a.quantity === 1) || b.id - a.id
	)[0];
}
