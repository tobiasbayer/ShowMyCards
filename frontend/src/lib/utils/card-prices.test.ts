import { describe, expect, it } from 'vitest';
import { highestOwnedPrice, printingPrice } from './card-prices';

const prices = {
	usd: '1.00',
	usd_foil: '5.00',
	usd_etched: '9.00',
	eur: '0.80',
	eur_foil: '4.00',
	tix: '0.10'
};

describe('printingPrice', () => {
	it('uses the nonfoil price first', () => {
		expect(printingPrice(prices, 'usd')).toBe(1);
		expect(printingPrice(prices, 'eur')).toBe(0.8);
	});

	it('falls back to foil, then etched', () => {
		expect(printingPrice({ usd_foil: '4.61', eur_foil: '7.68' }, 'usd')).toBe(4.61);
		expect(printingPrice({ usd_foil: '4.61', eur_foil: '7.68' }, 'eur')).toBe(7.68);
		expect(printingPrice({ usd_etched: '3.20' }, 'usd')).toBe(3.2);
	});

	it('is undefined without a price', () => {
		expect(printingPrice({}, 'usd')).toBeUndefined();
		expect(printingPrice({ usd: '', eur: ' ' }, 'eur')).toBeUndefined();
	});
});

describe('highestOwnedPrice', () => {
	it.each([
		[['nonfoil'], 'usd', 1],
		[['normal'], 'eur', 0.8],
		[['foil'], 'usd', 5],
		[['nonfoil', 'foil'], 'eur', 4],
		[['etched'], 'usd', 9],
		// No EUR etched price: etched uses EUR foil
		[['etched'], 'eur', 4],
		[['foil', 'etched'], 'usd', 9]
	] as const)('prices %j in %s at %d', (finishes, currency, want) => {
		expect(highestOwnedPrice(prices, finishes, currency)).toBe(want);
	});

	it("doesn't borrow another finish's price", () => {
		expect(highestOwnedPrice({ usd_foil: '5.00' }, ['nonfoil'], 'usd')).toBeUndefined();
	});

	it('is undefined without owned finishes', () => {
		expect(highestOwnedPrice(prices, [], 'usd')).toBeUndefined();
	});
});
