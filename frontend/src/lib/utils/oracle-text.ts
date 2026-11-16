// Card text for display: faces, lines and parts, with mana and tap symbols split
// out (for the Mana font) and reminder text marked.

import { manaSymbolClasses } from './mana';

export type OraclePart =
	| { kind: 'text'; text: string; reminder: boolean }
	| { kind: 'symbol'; cls: string; label: string };

/**
 * The Mana-font classes for a symbol token such as `{R}` or `{T}`. Mana costs
 * never contain {T}/{Q}, so `manaSymbolClasses` maps those to classes the font lacks.
 */
export function symbolClass(token: string): string {
	if (token === '{T}') return 'ms ms-tap ms-cost';
	if (token === '{Q}') return 'ms ms-untap ms-cost';
	return manaSymbolClasses(token)[0] ?? '';
}

/**
 * Oracle or printed text as faces → lines → parts. Faces are separated by a
 * "\n//\n" line (as the backend joins multi-face text); parenthesized text is
 * reminder text, and `{…}` tokens are symbols.
 */
export function parseOracleText(text: string | undefined): OraclePart[][][] {
	if (!text) return [];
	return text.split('\n//\n').map((face) =>
		face.split('\n').map((line) =>
			line
				.split(/(\([^)]*\))/)
				.filter(Boolean)
				.flatMap((chunk) => {
					const reminder = chunk.startsWith('(');
					return chunk
						.split(/(\{[^}]+\})/)
						.filter(Boolean)
						.map(
							(piece): OraclePart =>
								/^\{[^}]+\}$/.test(piece)
									? { kind: 'symbol', cls: symbolClass(piece), label: piece }
									: { kind: 'text', text: piece, reminder }
						);
				})
		)
	);
}
