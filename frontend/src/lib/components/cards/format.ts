// Wording shared by the Cards page's labels and messages.

/** A count with its noun: `plural(1, 'copy', 'copies')` is "1 copy", 3 gives "3 copies". */
export function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** The message of an error for a toast or an inline line. */
export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : 'unknown error';
}
