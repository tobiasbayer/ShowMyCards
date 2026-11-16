import { describe, expect, it } from 'vitest';
import { errorMessage, plural } from './format';

describe('plural', () => {
	it('uses the singular for exactly one', () => {
		expect(plural(1, 'copy', 'copies')).toBe('1 copy');
	});

	it('uses the plural for zero and for more than one', () => {
		expect(plural(0, 'copy', 'copies')).toBe('0 copies');
		expect(plural(3, 'copy', 'copies')).toBe('3 copies');
	});
});

describe('errorMessage', () => {
	it("uses an error's message and names anything else unknown", () => {
		expect(errorMessage(new Error('HTTP 500'))).toBe('HTTP 500');
		expect(errorMessage('boom')).toBe('unknown error');
	});
});
