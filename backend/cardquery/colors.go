package cardquery

import (
	"math/bits"
	"strconv"
)

// colorSet is a set of the five colours as a bit mask.
type colorSet uint8

const (
	white colorSet = 1 << iota
	blue
	black
	red
	green
)

var colorLetters = map[byte]colorSet{'w': white, 'u': blue, 'b': black, 'r': red, 'g': green}

// colorNames maps colour names and Scryfall's nicknames to colour sets.
var colorNames = map[string]colorSet{
	"white": white, "blue": blue, "black": black, "red": red, "green": green,
	// Guilds
	"azorius": white | blue, "dimir": blue | black, "rakdos": black | red,
	"gruul": red | green, "selesnya": green | white, "orzhov": white | black,
	"izzet": blue | red, "golgari": black | green, "boros": red | white,
	"simic": green | blue,
	// Shards
	"bant": green | white | blue, "esper": white | blue | black,
	"grixis": blue | black | red, "jund": black | red | green,
	"naya": red | green | white,
	// Wedges
	"abzan": white | black | green, "jeskai": blue | red | white,
	"sultai": black | green | blue, "mardu": red | white | black,
	"temur": green | blue | red,
	// Strixhaven colleges
	"silverquill": white | black, "prismari": blue | red,
	"witherbloom": black | green, "lorehold": red | white,
	"quandrix": green | blue,
	// Four colours, named for the missing one's opposite
	"chaos":      blue | black | red | green,
	"aggression": white | black | red | green,
	"altruism":   white | blue | red | green,
	"growth":     white | blue | black | green,
	"artifice":   white | blue | black | red,
}

func colorSetOf(letters []string) colorSet {
	var s colorSet
	for _, l := range letters {
		if len(l) == 1 {
			s |= colorLetters[l[0]|0x20]
		}
	}
	return s
}

func (s colorSet) count() int { return bits.OnesCount8(uint8(s)) }

// colorQuery is a parsed colour value: a set, "multicolor", or a count.
type colorQuery struct {
	set        colorSet
	colorless  bool
	multicolor bool
	count      int
	isCount    bool
}

func parseColorQuery(value string) (colorQuery, bool) {
	v := fold(value)
	switch v {
	case "":
		return colorQuery{}, false
	case "c", "colorless":
		return colorQuery{colorless: true}, true
	case "m", "multicolor":
		return colorQuery{multicolor: true}, true
	}
	if n, err := strconv.Atoi(v); err == nil && n >= 0 {
		return colorQuery{count: n, isCount: true}, true
	}
	if s, ok := colorNames[v]; ok {
		return colorQuery{set: s}, true
	}
	var s colorSet
	for i := 0; i < len(v); i++ {
		c, ok := colorLetters[v[i]]
		if !ok {
			return colorQuery{}, false
		}
		s |= c
	}
	return colorQuery{set: s}, true
}

// matchColors compares a card's colours with a query. colonMeans is the
// operator ":" stands for: ">=" for c: (includes these colours) and "<=" for
// id: (fits within these colours, the Commander rule).
func matchColors(card colorSet, q colorQuery, op, colonMeans string) bool {
	switch {
	case q.isCount:
		if op == ":" {
			op = "="
		}
		return compareNumbers(float64(card.count()), op, float64(q.count))
	case q.multicolor:
		if op == ":" || op == "=" {
			op = ">="
		}
		return compareNumbers(float64(card.count()), op, 2)
	case q.colorless && op == ":":
		return card == 0
	}
	if op == ":" {
		op = colonMeans
	}
	superset := card&q.set == q.set
	subset := card&^q.set == 0
	switch op {
	case "=":
		return card == q.set
	case "!=":
		return card != q.set
	case ">=":
		return superset
	case ">":
		return superset && card != q.set
	case "<=":
		return subset
	case "<":
		return subset && card != q.set
	}
	return false
}

// colorOrder sorts white, blue, black, red, green, then multicolour, then
// colourless, as Scryfall's order:color does.
func colorOrder(s colorSet) int {
	switch s.count() {
	case 0:
		return 6
	case 1:
		return bits.TrailingZeros8(uint8(s))
	}
	return 5
}
