/**
 * Returns the card's printed (localized) name when available, otherwise the
 * canonical English name. The backend sets `printed_name` only for non-English
 * cards (joining face names for multi-faced cards), so English cards fall back
 * to `name`.
 */
export function getDisplayName(card: { name?: string; printed_name?: string }): string {
	return card.printed_name || card.name || '';
}
