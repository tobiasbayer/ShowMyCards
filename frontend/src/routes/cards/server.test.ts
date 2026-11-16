import { describe, expect, it, vi, type Mock } from 'vitest';
import { load } from './+page.server';

const BACKEND_URL = 'http://localhost:3000';

type Route = (url: URL) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const bolt = { id: 'bolt-1', oracle_id: 'bolt', name: 'Lightning Bolt' };

/**
 * A backend whose storage and settings endpoints always answer; the card
 * endpoints answer with `collection` and `catalog` (or 404 when not given).
 */
function backend(routes: { collection?: Route; catalog?: Route } = {}): Mock {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		if (url.pathname === '/api/storage') return json({ data: [], total_pages: 1 });
		if (url.pathname === '/api/settings/scryfall_default_language') return json({ value: 'de' });
		if (url.pathname === '/api/inventory/search' && routes.collection)
			return routes.collection(url);
		if (url.pathname === '/api/search' && routes.catalog) return routes.catalog(url);
		return new Response('not found', { status: 404 });
	});
}

async function run(query: string, fetchMock: Mock) {
	// Only the fields the load reads; the full ServerLoadEvent has many more.
	const event = {
		fetch: fetchMock as unknown as typeof globalThis.fetch,
		url: new URL(`http://localhost/cards${query}`)
	} as unknown as Parameters<typeof load>[0];
	const data = await load(event);
	if (!data) throw new Error('load returned nothing');
	return data;
}

/** The URL of the first request to a backend path. */
function requestTo(fetchMock: Mock, pathname: string): URL {
	const call = fetchMock.mock.calls.find(([input]) => new URL(String(input)).pathname === pathname);
	if (!call) throw new Error(`no request to ${pathname}`);
	return new URL(String(call[0]));
}

const requested = (fetchMock: Mock, pathname: string) =>
	fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === pathname);

describe('/cards load', () => {
	describe('collection scopes', () => {
		const found = () => json({ data: [bolt], total_cards: 1 });

		it('searches the whole collection by default', async () => {
			const fetchMock = backend({ collection: found });

			const data = await run('', fetchMock);

			const url = requestTo(fetchMock, '/api/inventory/search');
			expect(url.origin).toBe(BACKEND_URL);
			expect(url.searchParams.has('q')).toBe(false);
			expect(url.searchParams.has('storage_location_id')).toBe(false);
			expect(data.cards.source).toBe('collection');
			expect(data.cards.collection).toEqual([bolt]);
			expect(data.cards.error).toBeNull();
			expect(data.defaultLanguage).toBe('de');
		});

		it.each([
			['?location=5', '5'],
			['?location=unassigned', 'null'],
			['?location=abc', null]
		])('scopes %s to storage_location_id=%s', async (query, expected) => {
			const fetchMock = backend({ collection: found });

			await run(query, fetchMock);

			const url = requestTo(fetchMock, '/api/inventory/search');
			expect(url.searchParams.get('storage_location_id')).toBe(expected);
		});

		it.each([
			[
				'a picked language and price sort',
				'?q=t:dragon&lang=ja&sort=usd-desc',
				't:dragon order:usd direction:desc l:ja'
			],
			['no language filter for Any', '?q=t:dragon&lang=any', 't:dragon'],
			['a typed language over the pick', '?q=t:dragon l:de&lang=ja', 't:dragon l:de'],
			['a typed order over the pick', '?q=order:cmc&sort=eur-asc', 'order:cmc'],
			['a sort without a query', '?sort=eur-asc', 'order:eur direction:asc']
		])('sends %s to the local engine', async (_, query, expected) => {
			const fetchMock = backend({ collection: found });

			await run(query, fetchMock);

			expect(requestTo(fetchMock, '/api/inventory/search').searchParams.get('q')).toBe(expected);
		});

		it('passes on the reason a query was rejected', async () => {
			const fetchMock = backend({
				collection: () =>
					json({ error: "`art:` isn't available in your collection", code: 'unsupported' }, 400)
			});

			const data = await run('?q=art:squirrel', fetchMock);

			expect(data.cards.queryError).toEqual({
				message: "`art:` isn't available in your collection",
				code: 'unsupported'
			});
			expect(data.cards.collection).toEqual([]);
		});

		it('reports a failed search as an error, not as no results', async () => {
			const fetchMock = backend({ collection: () => new Response('boom', { status: 500 }) });

			const data = await run('', fetchMock);

			expect(data.cards.error).toBe('Search failed (HTTP 500)');
		});

		it('reports an unreachable backend', async () => {
			const fetchMock = backend({
				collection: () => {
					throw new TypeError('fetch failed');
				}
			});

			const data = await run('', fetchMock);

			expect(data.cards.error).toBe("Couldn't load cards (fetch failed). Is the backend running?");
		});
	});

	describe('All cards', () => {
		const page = () => json({ data: [bolt], page: 1, total_cards: 120, has_more: true });

		it('never asks Scryfall without a query, not even for a sort', async () => {
			const fetchMock = backend({ catalog: page });

			const data = await run('?source=catalog&sort=usd-desc', fetchMock);

			expect(requested(fetchMock, '/api/search')).toBe(false);
			expect(data.cards.catalog).toEqual({ cards: [], hasMore: false, total: 0 });
		});

		it('loads the first page, leaving the language to the backend unless picked', async () => {
			const fetchMock = backend({ catalog: page });

			const data = await run('?source=catalog&q=bolt', fetchMock);

			const url = requestTo(fetchMock, '/api/search');
			expect(url.searchParams.get('q')).toBe('bolt');
			expect(url.searchParams.has('lang')).toBe(false);
			expect(data.cards.catalog).toEqual({ cards: [bolt], hasMore: true, total: 120 });
		});

		it('passes a picked language and price sort', async () => {
			const fetchMock = backend({ catalog: page });

			await run('?source=catalog&q=bolt&lang=any&sort=eur-asc', fetchMock);

			const url = requestTo(fetchMock, '/api/search');
			expect(url.searchParams.get('q')).toBe('bolt order:eur direction:asc');
			expect(url.searchParams.get('lang')).toBe('any');
		});

		it('treats no match as empty results', async () => {
			const fetchMock = backend({ catalog: () => json({ details: 'no cards' }, 404) });

			const data = await run('?source=catalog&q=xyzzy', fetchMock);

			expect(data.cards.error).toBeNull();
			expect(data.cards.catalog.cards).toEqual([]);
		});

		it.each([
			[
				'a collection keyword',
				{ error: '`qty` only works in your collection', code: 'collection_only', keyword: 'qty' },
				{ message: '`qty` only works in your collection', code: 'collection_only' }
			],
			[
				"Scryfall's warning",
				{ warnings: ['Unknown keyword "foo"'] },
				{ message: 'Unknown keyword "foo"', code: 'syntax' }
			],
			[
				'a fallback line',
				{ details: 'bad request' },
				{ message: "Scryfall couldn't read this search", code: 'syntax' }
			]
		])('explains a rejected search with %s', async (_, body, expected) => {
			const fetchMock = backend({ catalog: () => json(body, 400) });

			const data = await run('?source=catalog&q=foo:bar', fetchMock);

			expect(data.cards.queryError).toEqual(expected);
		});
	});

	it('falls back to English when the Settings language is unavailable', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			if (url.pathname === '/api/storage') return json({ data: [], total_pages: 1 });
			if (url.pathname === '/api/inventory/search') return json({ data: [], total_cards: 0 });
			return new Response('boom', { status: 500 });
		});

		const data = await run('', fetchMock);

		expect(data.defaultLanguage).toBe('en');
	});
});
