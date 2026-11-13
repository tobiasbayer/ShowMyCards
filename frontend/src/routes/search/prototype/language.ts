// PROTOTYPE. The Cards page's language dropdown: which languages it offers and
// what each scope shows when none was picked.

import { SCRYFALL_LANGUAGES } from '$lib/constants';
import type { Source } from './state.svelte';

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
 * The language a scope shows when none was picked: every language for the
 * collection, the Settings language for All cards.
 */
export function defaultLanguage(source: Source, settingsLanguage: string): string {
	return source === 'collection' ? ANY_LANGUAGE : settingsLanguage;
}

/**
 * The `?lang=` value to keep after a search or scope change: the pick, unless it
 * is what the scope would show anyway.
 */
export function languageParam(
	picked: string | null,
	source: Source,
	settingsLanguage: string
): string | null {
	return picked === null || picked === defaultLanguage(source, settingsLanguage) ? null : picked;
}

export function languageName(code: string): string {
	return LANGUAGE_OPTIONS.find((l) => l.code === code)?.name ?? code;
}
