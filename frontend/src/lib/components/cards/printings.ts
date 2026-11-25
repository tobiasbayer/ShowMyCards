// Other printings of a card, for the detail panel's thumbnail strip.

import { searchApi, type InventoryCard } from '#lib';

// Each lookup is one Scryfall request (1 per second), so they are cached per
// card and language for the session. A failed request isn't cached, so opening
// the card again retries.
const cache = new Map<string, Promise<InventoryCard[]>>();

/**
 * Every printing of a card in one language (a code, or empty for the Settings
 * language), plus every owned printing of that card regardless of language.
 */
export function loadPrintings(oracleId: string, language: string): Promise<InventoryCard[]> {
	const key = `${oracleId}|${language}`;
	let pending = cache.get(key);
	if (!pending) {
		pending = searchApi.printings(oracleId, language || undefined).then((res) => res ?? []);
		pending.catch(() => cache.delete(key));
		cache.set(key, pending);
	}
	return pending;
}

/**
 * Drops cached printing lists after an inventory write so newly added or
 * removed printings show up without reloading the page.
 */
export function invalidatePrintings(oracleId?: string): void {
	if (!oracleId) {
		cache.clear();
		return;
	}
	const prefix = `${oracleId}|`;
	for (const key of cache.keys()) {
		if (key.startsWith(prefix)) cache.delete(key);
	}
}
