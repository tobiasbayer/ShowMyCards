import { describe, expect, it } from 'vitest';
import { parseOracleText, symbolClass } from './oracle-text';

describe('parseOracleText', () => {
	it('is empty without text', () => {
		expect(parseOracleText(undefined)).toEqual([]);
		expect(parseOracleText('')).toEqual([]);
	});

	it('splits symbols out of a line', () => {
		expect(parseOracleText('{T}: Add {R}.')).toEqual([
			[
				[
					{ kind: 'symbol', cls: 'ms ms-tap ms-cost', label: '{T}' },
					{ kind: 'text', text: ': Add ', reminder: false },
					{ kind: 'symbol', cls: symbolClass('{R}'), label: '{R}' },
					{ kind: 'text', text: '.', reminder: false }
				]
			]
		]);
	});

	it('marks reminder text, symbols inside it too', () => {
		const [[line]] = parseOracleText('Flying (This creature can’t be blocked except by {W}.)');
		expect(line[0]).toEqual({ kind: 'text', text: 'Flying ', reminder: false });
		expect(line.slice(1).every((p) => p.kind === 'symbol' || p.reminder)).toBe(true);
		expect(line.some((p) => p.kind === 'symbol' && p.label === '{W}')).toBe(true);
	});

	it('keeps faces and lines apart', () => {
		const faces = parseOracleText('Front line one\nFront line two\n//\nBack');
		expect(faces).toHaveLength(2);
		expect(faces[0]).toHaveLength(2);
		expect(faces[1]).toEqual([[{ kind: 'text', text: 'Back', reminder: false }]]);
	});
});

describe('symbolClass', () => {
	it('maps tap and untap to the Mana font classes it has', () => {
		expect(symbolClass('{T}')).toBe('ms ms-tap ms-cost');
		expect(symbolClass('{Q}')).toBe('ms ms-untap ms-cost');
	});
});
