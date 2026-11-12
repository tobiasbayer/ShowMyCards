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
