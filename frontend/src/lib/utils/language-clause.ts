/**
 * A typed Scryfall language clause: `l:`, `lang:` or `language:` (the local
 * engine's alias), optionally negated with `-` or `!`. Mirrors the backend's
 * languageClauseRegExp in backend/api/search.go so a clause is never appended twice.
 */
export const LANGUAGE_CLAUSE_PATTERN = /(^|\s)([-!]?(?:l|lang|language):\S*)/i;

/** Whether the query already says which language to search. */
export function hasLanguageClause(query: string): boolean {
	return LANGUAGE_CLAUSE_PATTERN.test(query);
}

/** The typed language clause (e.g. `l:ja`), or null when there is none. */
export function typedLanguageClause(query: string): string | null {
	return query.match(LANGUAGE_CLAUSE_PATTERN)?.[2] ?? null;
}

/** Appends `l:<language>` unless the query has a language clause or `language` is empty. */
export function withLanguage(query: string, language?: string): string {
	if (!language || hasLanguageClause(query)) return query;
	return query.trim() ? `${query} l:${language}` : `l:${language}`;
}
