package cardquery

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// fold lowercases s and removes accents, so "Jötun" and "jotun" compare equal.
// Typographic apostrophes become ASCII ones, as Scryfall's own text mixes both.
func fold(s string) string {
	if isPlainASCII(s) {
		return strings.ToLower(s)
	}
	s = norm.NFD.String(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Mn, r):
			continue
		case r == '’' || r == '‘':
			b.WriteByte('\'')
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func isPlainASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}
