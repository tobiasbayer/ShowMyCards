// Other printings of a card, for the detail panel's thumbnail strip.

import { searchApi, type InventoryCard } from '#lib';

// Each lookup is one Scryfall request (1 per second), so they are cached per
// card and language for the session. A failed request isn't cached, so opening
// the card again retries.
const cache = new Map<string, Promise<InventoryCard[]>>();

/**
 * Every printing of a card in one language (a code, or empty for the Settings
 * language). The typed `l:` keeps the backend from adding the Settings language.
 */
export function loadPrintings(oracleId: string, language: string): Promise<InventoryCard[]> {
	const key = `${oracleId}|${language}`;
	let pending = cache.get(key);
	if (!pending) {
		const q = `oracleid:${oracleId} unique:prints${language ? ` l:${language}` : ''}`;
		pending = searchApi.cards({ q }).then((res) => res.data ?? []);
		pending.catch(() => cache.delete(key));
		cache.set(key, pending);
	}
	return pending;
}
