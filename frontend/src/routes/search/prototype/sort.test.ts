import { describe, expect, it } from 'vitest';
import { orderCurrency, parseSort, sortParam, typedOrderClause, withOrder } from './sort';

describe('parseSort', () => {
	it('reads a currency and a direction', () => {
		expect(parseSort('usd-desc')).toEqual({ currency: 'usd', direction: 'desc' });
		expect(parseSort('EUR-asc')).toEqual({ currency: 'eur', direction: 'asc' });
	});

	it.each([null, undefined, '', 'usd', 'tix-desc', 'usd-up', 'name'])('rejects %s', (value) =>
		expect(parseSort(value)).toBeNull()
	);

	it('round-trips through sortParam', () => {
		expect(sortParam(parseSort('eur-desc'))).toBe('eur-desc');
		expect(sortParam(null)).toBeNull();
	});
});

describe('typedOrderClause', () => {
	it.each([
		['order:usd', 'order:usd'],
		['bolt ORDER:eur dir:asc', 'ORDER:eur'],
		['t:goblin sort:name', 'sort:name']
	])('finds the clause in %s', (query, clause) => expect(typedOrderClause(query)).toBe(clause));

	it.each(['', 'bolt', 'border:white', 'direction:desc'])('ignores %s', (query) =>
		expect(typedOrderClause(query)).toBeNull()
	);
});

describe('withOrder', () => {
	const desc = { currency: 'usd', direction: 'desc' } as const;

	it('appends the picked sort', () => {
		expect(withOrder('t:goblin', desc)).toBe('t:goblin order:usd direction:desc');
		expect(withOrder('', { currency: 'eur', direction: 'asc' })).toBe('order:eur direction:asc');
	});

	it('leaves a typed order alone', () => {
		expect(withOrder('t:goblin order:name', desc)).toBe('t:goblin order:name');
	});

	it('leaves the query alone without a pick', () => {
		expect(withOrder('t:goblin', null)).toBe('t:goblin');
	});
});

describe('orderCurrency', () => {
	it('follows the pick', () => {
		expect(orderCurrency('bolt', { currency: 'eur', direction: 'desc' })).toBe('eur');
		expect(orderCurrency('bolt', null)).toBeNull();
	});

	it('lets a typed order win', () => {
		expect(orderCurrency('bolt order:EUR', { currency: 'usd', direction: 'desc' })).toBe('eur');
		expect(orderCurrency('bolt order:name', { currency: 'usd', direction: 'desc' })).toBeNull();
		expect(orderCurrency('bolt order:tix', null)).toBeNull();
	});
});
