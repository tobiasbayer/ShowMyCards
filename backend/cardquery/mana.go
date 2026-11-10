package cardquery

import (
	"fmt"
	"strconv"
	"strings"
)

// manaCost is a mana cost as a multiset: generic mana as a number and every
// other symbol counted by name ("U", "R/W", "U/P", "X", ...). Hybrid and
// Phyrexian symbols are their own symbols, as on Scryfall.
type manaCost struct {
	generic int
	symbols map[string]int
}

// parseManaCost reads a cost in braces ("{2}{U}{U}", "{1}{R} // {1}{U}") or
// the shorthand Scryfall accepts in queries ("2UU", "{R/W}g").
func parseManaCost(s string) (manaCost, error) {
	m := manaCost{symbols: map[string]int{}}
	s = strings.ToUpper(strings.ReplaceAll(s, "//", ""))
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == ' ':
			i++
		case c == '{':
			end := strings.IndexByte(s[i:], '}')
			if end < 0 {
				return manaCost{}, fmt.Errorf("missing `}`")
			}
			m.add(s[i+1 : i+end])
			i += end + 1
		case c >= '0' && c <= '9':
			j := i
			for j < len(s) && s[j] >= '0' && s[j] <= '9' {
				j++
			}
			m.add(s[i:j])
			i = j
		case strings.IndexByte("WUBRGCXYZS", c) >= 0:
			m.add(string(c))
			i++
		default:
			return manaCost{}, fmt.Errorf("unknown mana symbol `%c`", c)
		}
	}
	return m, nil
}

func (m *manaCost) add(symbol string) {
	if n, err := strconv.Atoi(symbol); err == nil {
		m.generic += n
		return
	}
	if symbol != "" {
		m.symbols[symbol]++
	}
}

// contains reports whether m holds at least every symbol of other.
func (m manaCost) contains(other manaCost) bool {
	if m.generic < other.generic {
		return false
	}
	for sym, n := range other.symbols {
		if m.symbols[sym] < n {
			return false
		}
	}
	return true
}

func (m manaCost) equals(other manaCost) bool {
	return m.contains(other) && other.contains(m)
}

func matchMana(card manaCost, op string, q manaCost) bool {
	switch op {
	case ":", ">=":
		return card.contains(q)
	case ">":
		return card.contains(q) && !card.equals(q)
	case "<=":
		return q.contains(card)
	case "<":
		return q.contains(card) && !card.equals(q)
	case "=":
		return card.equals(q)
	case "!=":
		return !card.equals(q)
	}
	return false
}
