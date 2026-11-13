import type { CardPrices } from '$lib';
import type { Currency } from '$lib/stores/currency.svelte';

/** The price shown for a treatment in the chosen currency. */
export function getTreatmentPrice(
	prices: CardPrices,
	treatment: string,
	currency: Currency
): string | undefined {
	if (treatment === 'foil') return currency === 'eur' ? prices.eur_foil : prices.usd_foil;
	// Scryfall has no separate EUR etched price; use EUR foil as in the price display.
	if (treatment === 'etched') return currency === 'eur' ? prices.eur_foil : prices.usd_etched;
	return currency === 'eur' ? prices.eur : prices.usd;
}

function toNumber(raw: string | undefined): number | undefined {
	if (!raw?.trim()) return undefined;
	const price = Number(raw);
	return Number.isFinite(price) && price >= 0 ? price : undefined;
}

/**
 * A printing's price as Scryfall sorts by it: nonfoil, else foil, else etched
 * (EUR has no etched price). Used where nothing is owned, e.g. All cards.
 */
export function printingPrice(prices: CardPrices, currency: Currency): number | undefined {
	const candidates =
		currency === 'eur'
			? [prices.eur, prices.eur_foil]
			: [prices.usd, prices.usd_foil, prices.usd_etched];
	for (const raw of candidates) {
		const price = toNumber(raw);
		if (price !== undefined) return price;
	}
	return undefined;
}

/**
 * The highest price among the owned finishes, so a foil copy counts as foil.
 * Mirrors the collection search's price (backend `cardquery`), which sorts and
 * filters by the same number. Undefined when no owned finish has a price.
 */
export function highestOwnedPrice(
	prices: CardPrices,
	finishes: Iterable<string>,
	currency: Currency
): number | undefined {
	let highest: number | undefined;
	for (const finish of finishes) {
		const price = toNumber(getTreatmentPrice(prices, finish, currency));
		if (price !== undefined && (highest === undefined || price > highest)) highest = price;
	}
	return highest;
}
