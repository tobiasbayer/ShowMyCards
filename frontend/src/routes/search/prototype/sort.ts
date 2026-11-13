// PROTOTYPE. The Cards page's sort menu: the `?sort=` value and the `order:`
// clause it adds to the search, like the language menu and `l:`.

import type { Currency } from '$lib/stores/currency.svelte';

/** A picked price sort. The currency is fixed when picked, so the URL says it. */
export interface PriceSort {
	currency: Currency;
	direction: 'asc' | 'desc';
}

/** A typed `order:` (or the engine's `sort:` alias); it wins over the menu. */
const ORDER_CLAUSE_PATTERN = /(^|\s)((?:order|sort):\S*)/i;

/** A `?sort=` value (`usd-desc`, `eur-asc`, …), else null (the scope's default order). */
export function parseSort(value: string | null | undefined): PriceSort | null {
	const match = value
		?.trim()
		.toLowerCase()
		.match(/^(usd|eur)-(asc|desc)$/);
	return match ? { currency: match[1] as Currency, direction: match[2] as 'asc' | 'desc' } : null;
}

export function sortParam(sort: PriceSort | null): string | null {
	return sort ? `${sort.currency}-${sort.direction}` : null;
}

/** The typed order clause (e.g. `order:usd`), or null when there is none. */
export function typedOrderClause(query: string): string | null {
	return query.match(ORDER_CLAUSE_PATTERN)?.[2] ?? null;
}

/** Appends the picked sort as `order:` and `direction:` unless the query has its own `order:`. */
export function withOrder(query: string, sort: PriceSort | null): string {
	if (!sort || typedOrderClause(query) !== null) return query;
	const clause = `order:${sort.currency} direction:${sort.direction}`;
	return query.trim() ? `${query} ${clause}` : clause;
}

/**
 * The currency the results are ordered by, if they are ordered by price: a typed
 * `order:usd|eur` wins, else the picked sort. Tiles show their price only then.
 */
export function orderCurrency(query: string, sort: PriceSort | null): Currency | null {
	const typed = typedOrderClause(query);
	if (typed === null) return sort?.currency ?? null;
	const key = typed.slice(typed.indexOf(':') + 1).toLowerCase();
	return key === 'usd' || key === 'eur' ? key : null;
}
