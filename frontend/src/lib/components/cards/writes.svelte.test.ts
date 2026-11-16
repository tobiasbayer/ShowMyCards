import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifications } from '#lib';
import { live } from './live.svelte';
import { card, fakeBackend, row, type FakeBackend } from './test-fixtures';
import { addCopy, deleteCopies, moveStack, removeCopy, resortCopies } from './writes';

// The #lib barrel pulls in components that use more of $app/navigation than goto.
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	refreshAll: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/cards') } }));

let backend: FakeBackend;

beforeEach(() => {
	live.reset();
	backend = fakeBackend();
	vi.spyOn(notifications, 'error');
	vi.spyOn(notifications, 'warning');
	vi.spyOn(notifications, 'success');
});

afterEach(() => vi.restoreAllMocks());

describe('addCopy', () => {
	it.each([
		['auto', {}],
		['unassigned', { unassigned: true }],
		[4, { storage_location_id: 4 }]
	] as const)('adds one copy to a stack at %s', async (destination, where) => {
		await addCopy(card(), 'foil', destination);

		expect(backend.bodyOf('POST /api/inventory')).toEqual({
			scryfall_id: 'bolt-1',
			oracle_id: 'bolt',
			treatment: 'foil',
			quantity: 1,
			merge: true,
			...where
		});
	});

	it('shows what the database holds after the save', async () => {
		backend.rows = [row(1, 3)];
		backend.availability = { owned: 3, decked: 1, free: 2, printings: { 'bolt-1': 2 } };

		const saved = await addCopy(card(), 'nonfoil', 'auto');

		expect(saved?.id).toBe(99);
		expect(live.rows['bolt-1']).toEqual([row(1, 3)]);
		expect(live.availability['bolt']).toEqual(backend.availability);
		expect(live.owned['bolt-1']).toBeDefined();
		expect(live.busy['bolt-1']).toBe(false);
	});

	it('reports a failed save and still re-reads the card', async () => {
		backend.failing = ['POST /api/inventory'];

		const saved = await addCopy(card(), 'nonfoil', 'auto');

		expect(saved).toBeUndefined();
		expect(notifications.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't save: /));
		expect(backend.requests()).toContain('GET /api/inventory/availability/bolt');
	});

	it('warns, without calling it a failed save, when only the re-read fails', async () => {
		backend.failing = ['GET /api/inventory/availability/'];

		const saved = await addCopy(card(), 'nonfoil', 'auto');

		expect(saved?.id).toBe(99);
		expect(notifications.error).not.toHaveBeenCalled();
		expect(notifications.warning).toHaveBeenCalledWith(
			expect.stringMatching(/^Saved, but couldn't reload the card/)
		);
	});

	it('runs quick repeated writes for a card one after another', async () => {
		const c = card();

		await Promise.all([addCopy(c, 'nonfoil', 'auto'), addCopy(c, 'foil', 'auto')]);

		const order = backend.requests().map((r) => r.split('?')[0]);
		// The second POST waits for the first write's re-read.
		expect(order).toEqual([
			'POST /api/inventory',
			'GET /api/inventory',
			'GET /api/inventory/availability/bolt',
			'POST /api/inventory',
			'GET /api/inventory',
			'GET /api/inventory/availability/bolt'
		]);
	});
});

describe('removeCopy', () => {
	it('lowers a row holding several copies', async () => {
		const c = card([row(1, 3)]);

		await removeCopy(c, { finish: 'nonfoil', locationId: 1, quantity: 3 });

		expect(backend.requests()[0]).toBe('PUT /api/inventory/1');
		expect(backend.bodyOf('PUT /api/inventory/1')).toEqual({ quantity: 2 });
	});

	it('deletes a row holding the last copy', async () => {
		const c = card([row(1, 1)]);

		await removeCopy(c, { finish: 'nonfoil', locationId: 1, quantity: 1 });

		expect(backend.requests()[0]).toBe('DELETE /api/inventory/1');
	});
});

describe('moveStack', () => {
	it('moves every copy of a split stack in one request', async () => {
		const c = card([row(1, 2), row(2, 3)]);

		await moveStack(c, { finish: 'nonfoil', locationId: 1, quantity: 5 }, 7);

		expect(backend.requests()[0]).toMatch(/^POST \/api\/inventory\/\d+\/split-move$/);
		expect(backend.bodyOf('POST /api/inventory/')).toEqual({ quantity: 5, storage_location_id: 7 });
	});

	it('moves to unassigned without a location', async () => {
		const c = card([row(1, 2)]);

		await moveStack(c, { finish: 'nonfoil', locationId: 1, quantity: 2 }, null);

		expect(backend.bodyOf('POST /api/inventory/1/split-move')).toEqual({ quantity: 2 });
	});
});

describe('bulk actions', () => {
	it('deletes in chunks of the backend batch limit', async () => {
		const rows = Array.from({ length: 1001 }, (_, i) => row(i + 1, 1));

		const done = await deleteCopies([card(rows)], 'all');

		expect(done).toBe(true);
		const batches = backend.spy.mock.calls
			.filter(
				([input, init]) => init?.method === 'DELETE' && String(input) === '/api/inventory/batch'
			)
			.map(([, init]) => JSON.parse(String(init?.body)).ids.length);
		expect(batches).toEqual([1000, 1]);
		expect(notifications.success).toHaveBeenCalledWith('Deleted 1001 copies');
	});

	it('never asks the rules to re-sort an empty selection (that re-sorts everything)', async () => {
		const done = await resortCopies([card([row(1, 1, 3)])], 5);

		expect(done).toBe(false);
		expect(backend.requests().some((r) => r.startsWith('POST /api/inventory/resort'))).toBe(false);
	});

	it('warns when cards could not be re-read after a bulk write', async () => {
		backend.failing = ['GET /api/inventory/availability/'];

		await deleteCopies([card([row(1, 1)])], 'all');

		expect(notifications.warning).toHaveBeenCalledWith(
			expect.stringMatching(/^Couldn't reload 1 card;/)
		);
	});
});
