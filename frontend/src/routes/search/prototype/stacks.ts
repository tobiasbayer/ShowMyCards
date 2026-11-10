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

const finishOf = (row: Inventory) => row.treatment || 'nonfoil';
const locationOf = (row: Inventory) => row.storage_location_id ?? null;

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
