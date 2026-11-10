import { describe, expect, it } from 'vitest';
import type { Inventory } from '$lib';
import { aggregateStacks, pickRowToDecrement, rowsOfStack } from './stacks';

function row(
	id: number,
	quantity: number,
	treatment = 'nonfoil',
	location: number | null = 1
): Inventory {
	return {
		id,
		created_at: '',
		updated_at: '',
		scryfall_id: 'card',
		oracle_id: 'oracle',
		treatment,
		quantity,
		storage_location_id: location ?? undefined
	};
}

describe('aggregateStacks', () => {
	it('sums rows of the same finish and location into one stack', () => {
		const stacks = aggregateStacks([
			row(1, 2),
			row(2, 1),
			row(3, 1, 'foil'),
			row(4, 3, 'nonfoil', null)
		]);
		expect(stacks).toEqual([
			{ finish: 'nonfoil', locationId: 1, quantity: 3 },
			{ finish: 'foil', locationId: 1, quantity: 1 },
			{ finish: 'nonfoil', locationId: null, quantity: 3 }
		]);
	});

	it('treats an empty treatment as nonfoil and skips empty rows', () => {
		expect(aggregateStacks([row(1, 1, ''), row(2, 0)])).toEqual([
			{ finish: 'nonfoil', locationId: 1, quantity: 1 }
		]);
	});
});

describe('rowsOfStack', () => {
	it('matches finish and location, including unassigned', () => {
		const rows = [
			row(1, 1),
			row(2, 1, 'foil'),
			row(3, 1, 'nonfoil', null),
			row(4, 1, 'nonfoil', 2)
		];
		expect(rowsOfStack(rows, { finish: 'nonfoil', locationId: 1 }).map((r) => r.id)).toEqual([1]);
		expect(rowsOfStack(rows, { finish: 'nonfoil', locationId: null }).map((r) => r.id)).toEqual([
			3
		]);
	});
});

describe('pickRowToDecrement', () => {
	const stack = { finish: 'nonfoil', locationId: 1 };

	it('prefers a single-copy row, newest first, so a split stack shrinks', () => {
		expect(pickRowToDecrement([row(1, 1), row(2, 3), row(3, 1)], stack)?.id).toBe(3);
	});

	it('otherwise takes the newest row', () => {
		expect(pickRowToDecrement([row(1, 2), row(5, 4), row(3, 2)], stack)?.id).toBe(5);
	});

	it('ignores rows of other stacks', () => {
		expect(pickRowToDecrement([row(1, 1, 'foil'), row(2, 1, 'nonfoil', 9)], stack)).toBeUndefined();
	});
});
