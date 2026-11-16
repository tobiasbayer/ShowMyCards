export type CompareOp = '=' | '>' | '<';
export type ColorMode = 'all' | 'any' | 'exactly';
export type Finish = '' | 'nonfoil' | 'foil' | 'etched';

export interface SearchBuilderParams {
	cardName: string;
	setCode: string;
	cardType: string;
	colors: Set<string>;
	colorMode: ColorMode;
	numericValues: Record<string, string>;
	numericOps: Record<string, CompareOp>;
	/** Collection only: the finish of the owned copies. */
	finish?: Finish;
}

export interface SearchBuilderOptions {
	/**
	 * Emit the collection-only terms (`finish:`, `qty`, `free`). Scryfall rejects
	 * them, so only the local collection search may receive them.
	 */
	collection?: boolean;
}

const NUMERIC_KEYWORDS: Record<string, string> = {
	mv: 'cmc',
	pow: 'pow',
	loy: 'loy',
	tou: 'tou'
};

/** Collection-only numeric fields: copies in scope, and copies free for decks. */
const COLLECTION_NUMERIC_KEYWORDS: Record<string, string> = {
	qty: 'qty',
	free: 'free'
};

const COLOR_ORDER = ['w', 'u', 'b', 'r', 'g', 'c'];

function numericTerms(p: SearchBuilderParams, keywords: Record<string, string>): string[] {
	const parts: string[] = [];
	for (const [id, keyword] of Object.entries(keywords)) {
		const val = (p.numericValues[id] ?? '').trim();
		if (val !== '') parts.push(`${keyword}${p.numericOps[id] ?? '='}${val}`);
	}
	return parts;
}

/**
 * `keyword:value`, quoted when the value has spaces or parentheses; '' when the
 * value is empty. Scryfall can't escape a `"` inside quotes, so those are dropped.
 */
function textTerm(keyword: string, raw: string): string {
	const value = raw.replace(/"/g, '').trim();
	if (!value) return '';
	return /[\s()]/.test(value) ? `${keyword}:"${value}"` : `${keyword}:${value}`;
}

export function buildSearchQuery(
	p: SearchBuilderParams,
	{ collection = false }: SearchBuilderOptions = {}
): string {
	const parts: string[] = [];

	const name = textTerm('name', p.cardName);
	if (name) parts.push(name);

	if (p.setCode.trim()) {
		parts.push(`s:${p.setCode.trim()}`);
	}

	const type = textTerm('t', p.cardType);
	if (type) parts.push(type);

	if (p.colors.size > 0) {
		const selected = COLOR_ORDER.filter((c) => p.colors.has(c));
		if (p.colorMode === 'all') {
			parts.push(`c:${selected.join('')}`);
		} else if (p.colorMode === 'exactly') {
			parts.push(`c=${selected.join('')}`);
		} else {
			parts.push(
				selected.length === 1
					? `c:${selected[0]}`
					: `(${selected.map((c) => `c:${c}`).join(' or ')})`
			);
		}
	}

	parts.push(...numericTerms(p, NUMERIC_KEYWORDS));

	if (collection) {
		if (p.finish) parts.push(`finish:${p.finish}`);
		parts.push(...numericTerms(p, COLLECTION_NUMERIC_KEYWORDS));
	}

	return parts.join(' ');
}
