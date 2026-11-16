// The All cards search the Cards page sends to Scryfall (through /api/search),
// shared by the server load (first page) and "load more" (next pages).

import { withOrder, type PriceSort } from './sort';

export interface CatalogSearch {
	/** The query with the picked price order appended, unless it has its own `order:`. */
	q: string;
	/** The picked language (a code or `any`); absent, the backend uses the Settings language. */
	lang?: string;
}

export function catalogSearch(
	query: string,
	language: string | null,
	sort: PriceSort | null
): CatalogSearch {
	const q = withOrder(query, sort);
	return language ? { q, lang: language } : { q };
}
