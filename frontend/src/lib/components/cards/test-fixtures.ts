// Test data for the Cards page's specs and tests.

import { vi, type MockInstance } from 'vitest';
import type {
	DeckAvailability,
	DeckCardUsage,
	Inventory,
	InventoryCard,
	StorageLocation
} from '$lib';
import { CardsView, type CardsPageData } from './view.svelte';

export function row(
	id: number,
	quantity: number,
	location: number | null = 1,
	treatment = 'nonfoil',
	scryfallId = 'bolt-1'
): Inventory {
	return {
		id,
		created_at: '',
		updated_at: '',
		scryfall_id: scryfallId,
		oracle_id: 'bolt',
		treatment,
		quantity,
		storage_location_id: location ?? undefined
	};
}

/** Lightning Bolt (M11) with the given rows of this printing. */
export function card(
	rows: Inventory[] = [],
	deck: Partial<DeckAvailability> = {},
	overrides: Partial<InventoryCard> = {}
): InventoryCard {
	return {
		id: 'bolt-1',
		oracle_id: 'bolt',
		name: 'Lightning Bolt',
		set_code: 'm11',
		set_name: 'Magic 2011',
		collector_number: '149',
		language: 'en',
		color_identity: ['R'],
		finishes: ['nonfoil', 'foil'],
		prices: { usd: '1.50' },
		inventory: { this_printing: rows, other_printings: [], total_quantity: 0 },
		deck: { owned: 0, decked: 0, free: 0, ...deck },
		...overrides
	};
}

export function location(id: number, name: string): StorageLocation {
	return { id, name, storage_type: 'Box', created_at: '', updated_at: '' };
}

export const boxA = location(1, 'Box A');
export const boxB = location(2, 'Box B');

/** A view as the server load would build it: My collection unless `data` says otherwise. */
export function cardsView(
	data: Partial<CardsPageData> = {},
	locations: StorageLocation[] = [boxA, boxB]
): CardsView {
	return new CardsView(
		{
			source: 'collection',
			query: '',
			language: null,
			sort: null,
			collection: [],
			catalog: { cards: [], hasMore: false, total: 0 },
			error: null,
			queryError: null,
			...data
		},
		locations,
		'en'
	);
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/**
 * A fake backend behind `fetch` (the browser's /api proxy). Tests set what it
 * answers; anything it doesn't know is a 404.
 */
export interface FakeBackend {
	/** Rows GET /api/inventory?scryfall_id= returns (re-read after each write). */
	rows: Inventory[];
	availability: DeckAvailability;
	/** GET /api/decks/for-card/:id. */
	decks: DeckCardUsage[];
	/** GET /api/search results (one page, no more). */
	search: InventoryCard[];
	/** Requests that fail with a 500, by "METHOD /path" prefix. */
	failing: string[];
	spy: MockInstance<typeof fetch>;
	/** "METHOD /path?query" of every request so far, in order. */
	requests(): string[];
	/** The JSON body of the first request starting with `prefix`. */
	bodyOf(prefix: string): unknown;
}

export function fakeBackend(): FakeBackend {
	const describe = (input: RequestInfo | URL, init?: RequestInit) =>
		`${init?.method ?? 'GET'} ${String(input)}`;
	const backend: FakeBackend = {
		rows: [],
		availability: { owned: 0, decked: 0, free: 0 },
		decks: [],
		search: [],
		failing: [],
		spy: vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = describe(input, init);
			const [method, url] = [init?.method ?? 'GET', String(input)];
			if (backend.failing.some((f) => request.startsWith(f))) {
				return json({ message: 'backend down' }, 500);
			}
			if (method === 'GET') {
				if (url.startsWith('/api/inventory?')) {
					return json({
						data: backend.rows,
						page: 1,
						page_size: 100,
						total_items: 0,
						total_pages: 1
					});
				}
				if (url.startsWith('/api/inventory/availability/')) return json(backend.availability);
				if (url.startsWith('/api/decks/for-card/')) return json(backend.decks);
				if (url.startsWith('/api/search?')) {
					return json({
						data: backend.search,
						page: 1,
						total_cards: backend.search.length,
						has_more: false
					});
				}
			}
			if (method === 'POST' && url === '/api/inventory') return json(row(99, 1), 201);
			if (method === 'PUT' || method === 'DELETE') return json({});
			if (method === 'POST') return json({ errors: 0 });
			return new Response('not found', { status: 404 });
		}),
		requests: () => backend.spy.mock.calls.map(([input, init]) => describe(input, init)),
		bodyOf: (prefix) => {
			const call = backend.spy.mock.calls.find(([input, init]) =>
				describe(input, init).startsWith(prefix)
			);
			return call ? JSON.parse(String(call[1]?.body)) : undefined;
		}
	};
	return backend;
}
