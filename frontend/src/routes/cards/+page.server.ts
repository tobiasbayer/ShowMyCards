import {
	BACKEND_URL,
	type CollectionSearchResponse,
	type QueryErrorResponse,
	type SearchResponse
} from '#lib';
import { loadStorageLocations } from '#lib/server/storage.ts';
import { withLanguage } from '#lib/utils/language-clause.ts';
import type { PageServerLoad } from './$types';
import type { CardsPageData } from '#lib/components/cards/view.svelte.ts';
import { catalogSearch } from '#lib/components/cards/catalog.ts';
import { ANY_LANGUAGE, parseLanguage } from '#lib/components/cards/language.ts';
import { parseSort, withOrder } from '#lib/components/cards/sort.ts';

// The cards for the URL's scope and search, and the storage locations (location
// dropdown, Move and Add).
export const load: PageServerLoad = async ({ fetch, url }) => {
	const [storageLocations, cards] = await Promise.all([
		loadStorageLocations(fetch),
		loadCards(fetch, url)
	]);
	return { storageLocations, cards };
};

// Collection scopes run the query (Scryfall syntax) on the backend's local engine
// over the owned printings in the chosen scope; All cards (`source=catalog`) loads
// the first Scryfall page for `q`. Every result carries its deck availability (per
// card, and free copies per owned printing). A picked language (`?lang=`) is added
// to the query unless the query names one; without a pick both views show every
// language (All cards sends `lang=any`, so the Settings language doesn't apply). A
// picked price sort (`?sort=`) is added as `order:`/`direction:` unless the query
// has its own `order:`.
async function loadCards(fetch: typeof globalThis.fetch, url: URL): Promise<CardsPageData> {
	const source = url.searchParams.get('source') === 'catalog' ? 'catalog' : 'collection';
	const query = url.searchParams.get('q')?.trim() ?? '';
	const language = parseLanguage(url.searchParams.get('lang'));
	const sort = parseSort(url.searchParams.get('sort'));
	const data: CardsPageData = {
		source,
		query,
		language,
		sort,
		collection: [],
		catalog: { cards: [], hasMore: false, total: 0 },
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
			} else if (response.status === 400) {
				data.queryError = await readQueryError(response);
			} else {
				data.error = `Search failed (HTTP ${response.status})`;
			}
			return data;
		}

		// A sort alone never starts a Scryfall search: it only orders one.
		if (query) {
			const params = new URLSearchParams({ ...catalogSearch(query, language, sort) });
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
