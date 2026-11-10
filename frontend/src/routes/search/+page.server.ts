import {
	BACKEND_URL,
	type DeckAvailability,
	type EnhancedCardResult,
	type InventoryCard,
	type SearchResponse
} from '$lib';
import {
	handleAddInventory,
	handleDeleteInventory,
	handleUpdateInventory
} from '$lib/server/inventory-actions';
import { loadStorageLocations } from '$lib/server/storage';
import { fetchAllInventoryCards } from '$lib/server/inventory-cards';
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { ProtoData } from './prototype/state.svelte';

// Load storage locations for the dropdown and the saved default language
export const load: PageServerLoad = async ({ fetch, url }) => {
	const [storageLocations, defaultLanguage] = await Promise.all([
		loadStorageLocations(fetch),
		loadDefaultLanguage(fetch)
	]);
	// PROTOTYPE: data for the `?variant=` Cards page prototype (dev only).
	const proto = dev && url.searchParams.get('variant') ? await loadPrototype(fetch, url) : null;
	return { storageLocations, defaultLanguage, proto };
};

// PROTOTYPE, throwaway: Collection loads every owned printing (filtered client-side);
// Catalog loads the first Scryfall page for `q`. Both read deck availability per
// card from the inventory endpoint, which is the only one that serves it.
async function loadPrototype(fetch: typeof globalThis.fetch, url: URL): Promise<ProtoData> {
	const source = url.searchParams.get('source') === 'catalog' ? 'catalog' : 'collection';
	const query = url.searchParams.get('q')?.trim() ?? '';
	const data: ProtoData = {
		source,
		query,
		collection: [],
		catalog: { cards: [], hasMore: false, total: 0 },
		availability: {},
		error: null
	};
	try {
		// Catalog only needs the collection for the deck badge, so a failure there just hides it.
		const collection =
			source === 'collection'
				? fetchAllInventoryCards(fetch)
				: fetchAllInventoryCards(fetch).catch(() => []);
		if (source === 'collection') {
			data.collection = await collection;
		} else if (query) {
			const response = await fetch(`${BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`);
			if (response.ok) {
				const result: SearchResponse = await response.json();
				data.catalog = {
					cards: result.data ?? [],
					hasMore: result.has_more,
					total: result.total_cards
				};
			} else if (response.status !== 404) {
				data.error = `Search failed (HTTP ${response.status})`;
			}
		}
		data.availability = availabilityByOracle(await collection);
	} catch (e) {
		data.error = e instanceof Error ? e.message : 'Failed to load cards';
	}
	return data;
}

function availabilityByOracle(cards: EnhancedCardResult[]): Record<string, DeckAvailability> {
	const byOracle: Record<string, DeckAvailability> = {};
	for (const card of cards) {
		// The inventory endpoint serves InventoryCard; fetchAllInventoryCards types it narrower.
		const deck = (card as InventoryCard).deck;
		if (deck) byOracle[card.oracle_id] = deck;
	}
	return byOracle;
}

async function loadDefaultLanguage(fetch: typeof globalThis.fetch): Promise<string> {
	try {
		const response = await fetch(`${BACKEND_URL}/api/settings/scryfall_default_language`);
		if (response.ok) {
			const data = (await response.json()) as { value?: string };
			if (data.value) return data.value;
		}
	} catch {
		// Fall through to default
	}
	return 'en';
}

export const actions = {
	// Search for cards
	search: async ({ request, fetch }) => {
		const formData = await request.formData();
		const query = formData.get('q');
		const lang = formData.get('lang');

		if (!query || typeof query !== 'string') {
			return fail(400, { error: 'Search query is required' });
		}

		try {
			const url = new URL(`${BACKEND_URL}/api/search`);
			url.searchParams.set('q', query);
			if (typeof lang === 'string' && lang.trim() !== '') {
				url.searchParams.set('lang', lang.trim());
			}

			const response = await fetch(url.toString());

			if (!response.ok) {
				return {
					success: false,
					error: `Search failed: ${response.statusText}`
				};
			}

			const data: SearchResponse = await response.json();

			return {
				success: true,
				data,
				query
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'An unknown error occurred'
			};
		}
	},

	addInventory: async ({ request, fetch }) => handleAddInventory(request, fetch),
	deleteInventory: async ({ request, fetch }) => handleDeleteInventory(request, fetch),
	updateInventory: async ({ request, fetch }) => handleUpdateInventory(request, fetch),

	// Get autocomplete suggestions via backend proxy
	autocomplete: async ({ request, fetch }) => {
		const formData = await request.formData();
		const query = formData.get('q');

		if (!query || typeof query !== 'string' || query.length < 2) {
			return { suggestions: [] };
		}

		try {
			const url = new URL(`${BACKEND_URL}/api/search/autocomplete`);
			url.searchParams.set('q', query);

			const response = await fetch(url.toString());

			if (!response.ok) {
				return { suggestions: [] };
			}

			const data: { suggestions: string[] } = await response.json();
			return { suggestions: data.suggestions };
		} catch {
			return { suggestions: [] };
		}
	}
} satisfies Actions;
