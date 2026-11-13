import { describe, expect, it } from 'vitest';
import { hasLanguageClause, typedLanguageClause, withLanguage } from './language-clause';

describe('hasLanguageClause', () => {
	it.each([
		'l:de',
		'lang:german',
		'language:ja',
		'L:EN',
		'-l:en',
		'!lang:en',
		'bolt l:de t:instant'
	])('finds %s', (query) => expect(hasLanguageClause(query)).toBe(true));

	it.each(['', 'lightning bolt', 'legal:standard', 'loyalty:3', 'layout:normal', 'name:lightning'])(
		'ignores %s',
		(query) => expect(hasLanguageClause(query)).toBe(false)
	);
});

describe('typedLanguageClause', () => {
	it('returns the clause as typed', () => {
		expect(typedLanguageClause('bolt -lang:fr t:instant')).toBe('-lang:fr');
	});

	it('returns null without a clause', () => {
		expect(typedLanguageClause('bolt')).toBeNull();
	});
});

describe('withLanguage', () => {
	it('appends the clause', () => {
		expect(withLanguage('sol ring', 'de')).toBe('sol ring l:de');
	});

	it('uses the clause alone for an empty query', () => {
		expect(withLanguage('', 'ja')).toBe('l:ja');
	});

	it('keeps a typed clause', () => {
		expect(withLanguage('sol ring language:fr', 'de')).toBe('sol ring language:fr');
	});

	it('leaves the query alone without a language', () => {
		expect(withLanguage('sol ring', '')).toBe('sol ring');
		expect(withLanguage('sol ring')).toBe('sol ring');
	});
});
