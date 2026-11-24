// The All cards search the Cards page sends to Scryfall (through /api/search),
// shared by the server load (first page) and "load more" (next pages).

import { ANY_LANGUAGE } from './language';
import { withOrder, type PriceSort } from './sort';

export interface CatalogSearch {
	/** The query with the picked price order appended, unless it has its own `order:`. */
	q: string;
	/**
	 * The picked language (a code), or `any` without a pick. Always sent, so the
	 * backend's Settings language never applies on the Cards page.
	 */
	lang: string;
}

export function catalogSearch(
	query: string,
	language: string | null,
	sort: PriceSort | null
): CatalogSearch {
	return { q: withOrder(query, sort), lang: language ?? ANY_LANGUAGE };
}
