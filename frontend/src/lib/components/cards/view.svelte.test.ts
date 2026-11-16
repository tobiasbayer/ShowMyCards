import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { live } from './live.svelte';
import { card, cardsView, fakeBackend, json, type FakeBackend } from './test-fixtures';

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
});

afterEach(() => vi.restoreAllMocks());

describe('CardsView', () => {
	/** All cards after searching "bolt": one page loaded, more to come. */
	const view = (data: Parameters<typeof cardsView>[0] = {}) =>
		cardsView({
			source: 'catalog',
			query: 'bolt',
			catalog: { cards: [card()], hasMore: true, total: 200 },
			...data
		});

	it('counts free copies per printing from the result, then from what a write re-read', () => {
		const v = view();
		const c = card([], { owned: 2, free: 1, printings: { 'bolt-1': 1 } });

		expect(v.freeForDecks(c)).toBe(1);
		live.availability['bolt'] = { owned: 2, decked: 2, free: 0, printings: { 'bolt-1': 0 } };
		expect(v.freeForDecks(c)).toBe(0);
	});

	it('stops loading more after a failure until Retry', async () => {
		backend.failing = ['GET /api/search'];
		const v = view();

		await v.loadMore();

		expect(v.loadMoreError).toMatch(/^Couldn't load more cards/);
		expect(v.canLoadMore).toBe(false);
		expect(v.hasMore).toBe(true);

		backend.failing = [];
		backend.spy.mockImplementationOnce(async () =>
			json({ data: [{ ...card(), id: 'bolt-2' }], page: 2, total_cards: 200, has_more: false })
		);
		v.retryLoadMore();
		await vi.waitFor(() => expect(v.catalog).toHaveLength(2));
		expect(v.loadMoreError).toBeNull();
		expect(v.hasMore).toBe(false);
	});

	it('asks for the next page with the picked language and sort', async () => {
		backend.spy.mockImplementationOnce(async () =>
			json({ data: [], page: 2, total_cards: 200, has_more: false })
		);
		const v = view({ language: 'ja', sort: { currency: 'usd', direction: 'desc' } });

		await v.loadMore();

		const url = new URL(backend.requests()[0].slice('GET '.length), 'http://localhost');
		expect(url.pathname).toBe('/api/search');
		expect(url.searchParams.get('q')).toBe('bolt order:usd direction:desc');
		expect(url.searchParams.get('lang')).toBe('ja');
		expect(url.searchParams.get('page')).toBe('2');
	});
});
