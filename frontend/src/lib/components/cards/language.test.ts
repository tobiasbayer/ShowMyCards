import { describe, expect, it } from 'vitest';
import { defaultLanguage, languageName, languageParam, parseLanguage } from './language';

describe('parseLanguage', () => {
	it('accepts offered codes and any', () => {
		expect(parseLanguage('ja')).toBe('ja');
		expect(parseLanguage('ZHS')).toBe('zhs');
		expect(parseLanguage('any')).toBe('any');
	});

	it('rejects missing and unknown values', () => {
		expect(parseLanguage(null)).toBeNull();
		expect(parseLanguage('')).toBeNull();
		expect(parseLanguage('klingon')).toBeNull();
	});
});

describe('defaultLanguage', () => {
	it('shows every language in the collection', () => {
		expect(defaultLanguage('collection', 'de')).toBe('any');
	});

	it('uses the Settings language for All cards', () => {
		expect(defaultLanguage('catalog', 'de')).toBe('de');
	});
});

describe('languageParam', () => {
	it('keeps a pick that differs from the scope default', () => {
		expect(languageParam('ja', 'collection', 'de')).toBe('ja');
		expect(languageParam('ja', 'catalog', 'de')).toBe('ja');
		expect(languageParam('any', 'catalog', 'de')).toBe('any');
	});

	it('drops a pick equal to the scope default', () => {
		expect(languageParam('any', 'collection', 'de')).toBeNull();
		expect(languageParam('de', 'catalog', 'de')).toBeNull();
	});

	it('carries a pick across scopes until it matches the default there', () => {
		// German picked in the collection: kept there, dropped in All cards (Settings = German).
		expect(languageParam('de', 'collection', 'de')).toBe('de');
		expect(languageParam('de', 'catalog', 'de')).toBeNull();
	});

	it('has nothing to keep without a pick', () => {
		expect(languageParam(null, 'catalog', 'de')).toBeNull();
	});
});

describe('languageName', () => {
	it('names codes and any', () => {
		expect(languageName('de')).toBe('German');
		expect(languageName('any')).toBe('Any language');
	});
});
