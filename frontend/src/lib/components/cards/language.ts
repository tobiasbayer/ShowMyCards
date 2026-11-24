// The Cards page's language dropdown: which languages it offers and what is
// shown when none was picked (every language, in both views).

import { SCRYFALL_LANGUAGES } from '#lib/constants.ts';

/** "Any language": no filter in the collection, `l:any` on Scryfall. */
export const ANY_LANGUAGE = 'any';

/** The dropdown's entries, Any first. */
export const LANGUAGE_OPTIONS: readonly { code: string; name: string }[] = [
	{ code: ANY_LANGUAGE, name: 'Any language' },
	...SCRYFALL_LANGUAGES
];

/** A `?lang=` value the dropdown offers, else null (missing or unknown). */
export function parseLanguage(value: string | null | undefined): string | null {
	const code = value?.trim().toLowerCase();
	return code && LANGUAGE_OPTIONS.some((l) => l.code === code) ? code : null;
}

/**
 * The `?lang=` value to keep after a search or a view change: the pick, unless it
 * is Any, which every view shows anyway.
 */
export function languageParam(picked: string | null): string | null {
	return picked === null || picked === ANY_LANGUAGE ? null : picked;
}

export function languageName(code: string): string {
	return LANGUAGE_OPTIONS.find((l) => l.code === code)?.name ?? code;
}
