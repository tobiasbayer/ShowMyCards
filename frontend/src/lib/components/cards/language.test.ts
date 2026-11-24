import { describe, expect, it } from 'vitest';
import { languageName, languageParam, parseLanguage } from './language';

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

describe('languageParam', () => {
	it('keeps a picked language', () => {
		expect(languageParam('ja')).toBe('ja');
		expect(languageParam('de')).toBe('de');
	});

	it('drops Any, the default in every view', () => {
		expect(languageParam('any')).toBeNull();
	});

	it('has nothing to keep without a pick', () => {
		expect(languageParam(null)).toBeNull();
	});
});

describe('languageName', () => {
	it('names codes and any', () => {
		expect(languageName('de')).toBe('German');
		expect(languageName('any')).toBe('Any language');
	});
});
