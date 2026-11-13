import {
	BACKEND_URL,
	type CollectionSearchResponse,
	type DeckAvailability,
	type EnhancedCardResult,
	type InventoryCard,
	type QueryErrorResponse,
	type SearchResponse
} from '$lib';
import {
	handleAddInventory,
	handleDeleteInventory,
	handleUpdateInventory
} from '$lib/server/inventory-actions';
import { loadStorageLocations } from '$lib/server/storage';
import { fetchAllInventoryCards } from '$lib/server/inventory-cards';
import { withLanguage } from '$lib/utils/language-clause';
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import type { ProtoData } from './prototype/state.svelte';
import { ANY_LANGUAGE, parseLanguage } from './prototype/language';
import { parseSort, withOrder } from './prototype/sort';

// Load storage locations for the dropdown and the saved default language
export const load: PageServerLoad = async ({ fetch, url }) => {
	// PROTOTYPE branch: /search is the Cards page; `?variant=current` is today's search page.
	const [storageLocations, defaultLanguage, proto] = await Promise.all([
		loadStorageLocations(fetch),
		loadDefaultLanguage(fetch),
		url.searchParams.get('variant') === 'current' ? null : loadPrototype(fetch, url)
	]);
	return { storageLocations, defaultLanguage, proto };
};

// PROTOTYPE, throwaway: Collection runs the query (Scryfall syntax) on the backend's
// local engine over the owned printings in the chosen scope; Catalog loads the first
// Scryfall page for `q`. Both read deck availability (per card, and free copies per
// owned printing) from inventory results. A picked language (`?lang=`) is added to
// the query unless the query names one; without a pick the collection shows every
// language and Scryfall gets the Settings language from the backend. A picked price
// sort (`?sort=`) is added as `order:`/`direction:` unless the query has an `order:`.
async function loadPrototype(fetch: typeof globalThis.fetch, url: URL): Promise<ProtoData> {
	const source = url.searchParams.get('source') === 'catalog' ? 'catalog' : 'collection';
	const query = url.searchParams.get('q')?.trim() ?? '';
	const language = parseLanguage(url.searchParams.get('lang'));
	const sort = parseSort(url.searchParams.get('sort'));
	const data: ProtoData = {
		source,
		query,
		language,
		sort,
		collection: [],
		catalog: { cards: [], hasMore: false, total: 0 },
		availability: {},
		error: null,
		queryError: null
	};
	try {
		if (source === 'collection') {
			const params = new URLSearchParams();
			const q = withLanguage(
				withOrder(query, sort),
				language === ANY_LANGUAGE ? '' : (language ?? '')
			);
			if (q) params.set('q', q);
			const location = url.searchParams.get('location');
			if (location === 'unassigned') params.set('storage_location_id', 'null');
			else if (location && /^\d+$/.test(location)) params.set('storage_location_id', location);
			const response = await fetch(`${BACKEND_URL}/api/inventory/search?${params}`);
			if (response.ok) {
				const result: CollectionSearchResponse = await response.json();
				data.collection = result.data ?? [];
				data.availability = availabilityByOracle(data.collection);
			} else if (response.status === 400) {
				data.queryError = await readQueryError(response);
			} else {
				data.error = `Search failed (HTTP ${response.status})`;
			}
			return data;
		}

		// Catalog only needs the collection for the deck badge, so a failure there just hides it.
		const collection = fetchAllInventoryCards(fetch).catch(() => []);
		// A sort alone never starts a Scryfall search: it only orders one.
		if (query) {
			const params = new URLSearchParams({ q: withOrder(query, sort) });
			if (language) params.set('lang', language);
			const response = await fetch(`${BACKEND_URL}/api/search?${params}`);
			if (response.ok) {
				const result: SearchResponse = await response.json();
				data.catalog = {
					cards: result.data ?? [],
					hasMore: result.has_more,
					total: result.total_cards
				};
			} else if (response.status === 400) {
				data.queryError = await readQueryError(response);
			} else if (response.status !== 404) {
				data.error = `Search failed (HTTP ${response.status})`;
			}
		}
		data.availability = availabilityByOracle(await collection);
	} catch (e) {
		const reason = e instanceof Error ? e.message : 'unknown error';
		data.error = `Couldn't load cards (${reason}). Is the backend running?`;
	}
	return data;
}

/**
 * A search the backend rejected: the local engine's message, a collection keyword
 * used in All cards, or a query Scryfall couldn't read.
 */
async function readQueryError(response: Response): Promise<{ message: string; code: string }> {
	const body = (await response.json().catch(() => ({}))) as Partial<
		QueryErrorResponse & { warnings: string[] }
	>;
	if (body.error && body.code && queryErrorCodes.has(body.code)) {
		return { message: body.error, code: body.code };
	}
	return { message: body.warnings?.[0] ?? "Scryfall couldn't read this search", code: 'syntax' };
}

/** Codes whose message is written for people (see backend api.QueryErrorResponse). */
const queryErrorCodes = new Set([
	'syntax',
	'unsupported',
	'unknown_keyword',
	'invalid_value',
	'collection_only'
]);

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
