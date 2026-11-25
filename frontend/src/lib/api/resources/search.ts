import { apiClient } from '../client';
import type { InventoryCard, SearchResponse } from '#lib';

/**
 * Query parameters for card search
 */
export interface SearchParams {
	q: string;
	page?: number;
	/** A language code or `any`; without it the backend uses the Settings language. */
	lang?: string;
}

/**
 * Card search API methods
 *
 * Provides type-safe access to Scryfall card search endpoints (proxied through backend).
 *
 * @example
 * ```ts
 * import { searchApi } from '#lib/api/index.ts';
 *
 * // Search for cards
 * const results = await searchApi.cards({ q: 'lightning bolt', page: 1 });
 * ```
 */
export const searchApi = {
	/**
	 * Search for cards using Scryfall syntax
	 *
	 * @param params - Search query and optional page number
	 */
	cards: (params: SearchParams) => {
		const searchParams = new URLSearchParams();
		searchParams.set('q', params.q);
		if (params.page) searchParams.set('page', String(params.page));
		if (params.lang) searchParams.set('lang', params.lang);

		return apiClient.get<SearchResponse>(`/search?${searchParams.toString()}`);
	},

	/**
	 * Fetch all printings of a card by oracle ID, combining owned printings
	 * across all languages with language-filtered Scryfall printings.
	 */
	printings: (oracleId: string, lang?: string) => {
		const searchParams = new URLSearchParams();
		if (lang) searchParams.set('lang', lang);
		const query = searchParams.toString();
		return apiClient.get<InventoryCard[]>(
			`/cards/printings/${encodeURIComponent(oracleId)}${query ? `?${query}` : ''}`
		);
	}
};
