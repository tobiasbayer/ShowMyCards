package cardquery

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// pred tests one printing.
type pred func(p *Printing) bool

// keywordAliases maps every supported keyword, as typed, to its canonical name.
var keywordAliases = map[string]string{
	"name": "name",
	"t":    "type", "type": "type",
	"o": "oracle", "oracle": "oracle",
	"fo": "fulloracle", "fulloracle": "fulloracle",
	"kw": "keyword", "keyword": "keyword",
	"ft": "flavor", "flavor": "flavor",
	"a": "artist", "artist": "artist",
	"c": "color", "color": "color",
	"id": "identity", "identity": "identity", "ci": "identity",
	"m": "mana", "mana": "mana",
	"mv": "mv", "cmc": "mv", "manavalue": "mv",
	"pow": "power", "power": "power",
	"tou": "toughness", "toughness": "toughness",
	"loy": "loyalty", "loyalty": "loyalty",
	"pt": "pt", "powtou": "pt",
	"r": "rarity", "rarity": "rarity",
	"s": "set", "set": "set", "e": "set", "edition": "set",
	"cn": "number", "number": "number",
	"l": "lang", "lang": "lang", "language": "lang",
	"year": "year",
	"f":    "format", "format": "format", "legal": "format",
	"banned":     "banned",
	"restricted": "restricted",
	"usd":        "usd", "eur": "eur", "tix": "tix",
	"layout": "layout",
	"is":     "is", "not": "not",
	"has": "has",
	"wm":  "watermark", "watermark": "watermark",
	"border": "border",
	"frame":  "frame",
	"finish": "finish",
	"qty":    "qty",
	"free":   "free",
	"order":  "order", "sort": "order",
	"direction": "direction", "dir": "direction",
}

// collectionOnly keywords describe your copies, so Scryfall can't answer them.
var collectionOnly = map[string]bool{"finish": true, "qty": true, "free": true}

// unsupportedKeywords exist on Scryfall but need data that isn't in the card
// JSON stored locally (tags, cubes, other printings, games, set types, ...).
var unsupportedKeywords = map[string]bool{
	"art": true, "atag": true, "arttag": true,
	"function": true, "otag": true, "oracletag": true,
	"cube": true, "block": true, "b": true,
	"cheapest": true, "new": true, "unique": true,
	"prints": true, "paperprints": true, "sets": true, "papersets": true,
	"date": true, "in": true, "include": true, "prefer": true, "display": true,
	"st": true, "game": true, "stamp": true, "devotion": true, "produces": true,
	"def": true, "defense": true, "lore": true, "illustrations": true,
	"flavorname": true, "penny": true,
}

var layouts = []string{
	"normal", "split", "flip", "transform", "modal_dfc", "meld", "leveler",
	"class", "case", "saga", "adventure", "mutate", "prototype", "battle",
	"planar", "scheme", "vanguard", "token", "double_faced_token", "emblem",
	"augment", "host", "art_series", "reversible_card", "prepare",
}

var formats = []string{
	"standard", "future", "historic", "timeless", "gladiator", "pioneer",
	"explorer", "modern", "legacy", "pauper", "vintage", "penny", "commander",
	"oathbreaker", "standardbrawl", "brawl", "historicbrawl", "alchemy",
	"paupercommander", "duel", "oldschool", "premodern", "predh", "tlr",
}

var formatAliases = map[string]string{"edh": "commander", "pdh": "paupercommander"}

var languages = map[string]string{
	"english": "en", "spanish": "es", "french": "fr", "german": "de",
	"italian": "it", "portuguese": "pt", "japanese": "ja", "korean": "ko",
	"russian": "ru", "hebrew": "he", "latin": "la", "ancientgreek": "grc",
	"arabic": "ar", "sanskrit": "sa", "phyrexian": "ph", "quenya": "qya",
}

var rarityRank = map[string]int{
	"common": 0, "uncommon": 1, "rare": 2, "special": 3, "mythic": 4, "bonus": 5,
	"c": 0, "u": 1, "r": 2, "s": 3, "m": 4, "b": 5,
}

// isValues are the supported is: (and not:) values.
var isValues = map[string]pred{
	"promo":     func(p *Printing) bool { return p.Promo },
	"reprint":   func(p *Printing) bool { return p.Reprint },
	"full":      func(p *Printing) bool { return p.FullArt },
	"fullart":   func(p *Printing) bool { return p.FullArt },
	"reserved":  func(p *Printing) bool { return p.Reserved },
	"digital":   func(p *Printing) bool { return p.Digital },
	"split":     layoutIs("split"),
	"flip":      layoutIs("flip"),
	"adventure": layoutIs("adventure"),
	"leveler":   layoutIs("leveler"),
	"meld":      layoutIs("meld"),
	"transform": layoutIs("transform"),
	"tdfc":      layoutIs("transform"),
	"mdfc":      layoutIs("modal_dfc"),
	"dfc":       layoutIs("transform", "modal_dfc"),
	"foil":      printFinish("foil"),
	"nonfoil":   printFinish("nonfoil"),
	"etched":    printFinish("etched"),
	"commander": isCommander,
}

func layoutIs(names ...string) pred {
	return func(p *Printing) bool { return slices.Contains(names, p.Layout) }
}

func printFinish(finish string) pred {
	return func(p *Printing) bool { return slices.Contains(p.PrintFinishes, finish) }
}

// isCommander: the front face is a legendary creature (or a legendary
// vehicle, spacecraft or background), or the card says it can be your
// commander; and the card isn't banned in Commander. Meld results never are.
func isCommander(p *Printing) bool {
	if p.isMeldResult || p.Legalities["commander"] == "banned" {
		return false
	}
	if strings.Contains(p.front, "legendary") {
		for _, kind := range []string{"creature", "vehicle", "spacecraft", "background"} {
			if strings.Contains(p.front, kind) {
				return true
			}
		}
	}
	for _, b := range p.texts {
		for _, line := range b.lines {
			if strings.Contains(line, "can be your commander") {
				return true
			}
		}
	}
	return false
}

// compileTerm turns one "key op value" term into a predicate. It returns a nil
// predicate for terms that only set options (order:, direction:).
func (q *Query) compileTerm(t token) (pred, error) {
	if t.regex {
		return nil, &Error{
			Code:    CodeUnsupported,
			Keyword: t.key,
			Pos:     t.pos,
			Message: "Regular expressions aren't available in your collection",
		}
	}
	key, ok := keywordAliases[t.key]
	if !ok {
		if unsupportedKeywords[t.key] {
			return nil, unsupported(t, fmt.Sprintf("`%s:`", t.key))
		}
		return nil, &Error{
			Code:    CodeUnknownKeyword,
			Keyword: t.key,
			Pos:     t.pos,
			Message: fmt.Sprintf("`%s:` isn't a search keyword", t.key),
		}
	}
	value := fold(t.value)

	switch key {
	case "name":
		return textTerm(t, func(p *Printing) bool { return anyContains(p.names, value) })
	case "type":
		return textTerm(t, func(p *Printing) bool { return anyContains(p.types, value) })
	case "oracle", "fulloracle":
		full := key == "fulloracle"
		return textTerm(t, func(p *Printing) bool { return textMatches(p.texts, value, full) })
	case "keyword":
		return textTerm(t, func(p *Printing) bool { return slices.Contains(p.Keywords, value) })
	case "flavor":
		return textTerm(t, func(p *Printing) bool { return anyContains(p.flavors, value) })
	case "artist":
		return textTerm(t, func(p *Printing) bool { return anyContains(p.artists, value) })
	case "watermark":
		return textTerm(t, func(p *Printing) bool { return p.Watermark == value })
	case "border":
		return textTerm(t, func(p *Printing) bool { return p.BorderColor == value })
	case "frame":
		return textTerm(t, func(p *Printing) bool {
			return p.Frame == value || slices.Contains(p.FrameEffects, value)
		})
	case "set":
		return textTerm(t, func(p *Printing) bool { return p.Set == value })

	case "color", "identity":
		cq, ok := parseColorQuery(t.value)
		if !ok {
			return nil, invalidValue(t, "expected colours such as `wu`, `red` or `esper`")
		}
		if key == "color" {
			return func(p *Printing) bool { return matchColors(p.colors, cq, t.op, ">=") }, nil
		}
		return func(p *Printing) bool { return matchColors(p.colorIdentity, cq, t.op, "<=") }, nil

	case "mana":
		cost, err := parseManaCost(t.value)
		if err != nil || t.value == "" {
			return nil, invalidValue(t, "expected a mana cost such as `2WW` or `{R/W}`")
		}
		return func(p *Printing) bool {
			for _, c := range p.costs {
				if matchMana(c, t.op, cost) {
					return true
				}
			}
			return false
		}, nil

	case "mv":
		if value == "even" || value == "odd" {
			neg, err := textOp(t)
			if err != nil {
				return nil, err
			}
			want := 0
			if value == "odd" {
				want = 1
			}
			return negateIf(neg, func(p *Printing) bool {
				return p.CMC == float64(int(p.CMC)) && int(p.CMC)%2 == want
			}), nil
		}
		return numberTerm(t, func(p *Printing) (float64, bool) { return p.CMC, true })

	case "power", "toughness", "loyalty", "pt":
		return statTerm(t, key)

	case "rarity":
		want, ok := rarityRank[value]
		if !ok {
			return nil, invalidValue(t, "expected a rarity such as `common` or `mythic`")
		}
		return func(p *Printing) bool {
			have, ok := rarityRank[p.Rarity]
			return ok && compareNumbers(float64(have), t.op, float64(want))
		}, nil

	case "number":
		if t.op == ":" || t.op == "=" || t.op == "!=" {
			return textTerm(t, func(p *Printing) bool { return fold(p.CollectorNumber) == value })
		}
		n, err := strconv.Atoi(t.value)
		if err != nil {
			return nil, invalidValue(t, "expected a number")
		}
		return func(p *Printing) bool {
			have, ok := leadingInt(p.CollectorNumber)
			return ok && compareNumbers(float64(have), t.op, float64(n))
		}, nil

	case "lang":
		if value == "any" {
			return textTerm(t, func(*Printing) bool { return true })
		}
		code := value
		if c, ok := languages[value]; ok {
			code = c
		}
		if !slices.Contains(languageCodes(), code) {
			return nil, invalidValue(t, "expected a language such as `de` or `german`")
		}
		return textTerm(t, func(p *Printing) bool { return p.Lang == code })

	case "year":
		return numberTerm(t, func(p *Printing) (float64, bool) {
			y := p.releaseYear()
			return float64(y), y > 0
		})

	case "format", "banned", "restricted":
		format := value
		if alias, ok := formatAliases[value]; ok {
			format = alias
		}
		if !slices.Contains(formats, format) {
			return nil, invalidValue(t, "unknown format")
		}
		return textTerm(t, func(p *Printing) bool {
			status := p.Legalities[format]
			switch key {
			case "banned":
				return status == "banned"
			case "restricted":
				return status == "restricted"
			}
			return status == "legal" || status == "restricted"
		})

	case "usd", "eur", "tix":
		return numberTerm(t, func(p *Printing) (float64, bool) {
			price := p.Prices.byKey(key)
			if price == nil {
				return 0, false
			}
			return *price, true
		})

	case "layout":
		if !slices.Contains(layouts, value) {
			return nil, invalidValue(t, "unknown layout")
		}
		return textTerm(t, func(p *Printing) bool { return p.Layout == value })

	case "is", "not":
		if t.op != ":" && t.op != "=" {
			return nil, invalidValue(t, fmt.Sprintf("use `:` with `%s`", t.key))
		}
		is, ok := isValues[value]
		if !ok {
			return nil, unsupported(t, fmt.Sprintf("`%s:%s`", t.key, t.value))
		}
		return negateIf(key == "not", is), nil

	case "has":
		if value != "watermark" && value != "wm" {
			return nil, unsupported(t, fmt.Sprintf("`has:%s`", t.value))
		}
		return textTerm(t, func(p *Printing) bool { return p.Watermark != "" })

	case "finish":
		if value != "foil" && value != "nonfoil" && value != "etched" {
			return nil, invalidValue(t, "expected `foil`, `nonfoil` or `etched`")
		}
		return textTerm(t, func(p *Printing) bool {
			for _, f := range p.Finishes {
				if f == value || (value == "nonfoil" && f == "normal") {
					return true
				}
			}
			return false
		})
	case "qty":
		return numberTerm(t, func(p *Printing) (float64, bool) { return float64(p.Quantity), true })
	case "free":
		return numberTerm(t, func(p *Printing) (float64, bool) { return float64(p.Free), true })

	case "order":
		if _, ok := orderKeys[value]; !ok {
			if slices.Contains([]string{"penny", "review", "spoiled", "imageupdated"}, value) {
				return nil, unsupported(t, fmt.Sprintf("`order:%s`", t.value))
			}
			return nil, invalidValue(t, "unknown sort order")
		}
		q.order = value
		return nil, nil
	case "direction":
		switch value {
		case "asc", "desc", "auto":
			q.direction = value
			return nil, nil
		}
		return nil, invalidValue(t, "expected `asc` or `desc`")
	}
	return nil, invalidValue(t, "unsupported keyword")
}

// textTerm accepts ":" and "=" (match) and "!=" (doesn't match).
func textTerm(t token, match pred) (pred, error) {
	neg, err := textOp(t)
	if err != nil {
		return nil, err
	}
	if t.value == "" {
		return nil, invalidValue(t, "expected a value")
	}
	return negateIf(neg, match), nil
}

func textOp(t token) (negate bool, err error) {
	switch t.op {
	case ":", "=":
		return false, nil
	case "!=":
		return true, nil
	}
	return false, invalidValue(t, fmt.Sprintf("use `:` with `%s`", t.key))
}

func negateIf(neg bool, p pred) pred {
	if !neg {
		return p
	}
	return func(x *Printing) bool { return !p(x) }
}

// numberTerm compares a number. A printing without the value never matches.
func numberTerm(t token, get func(p *Printing) (float64, bool)) (pred, error) {
	want, err := strconv.ParseFloat(t.value, 64)
	if err != nil {
		return nil, invalidValue(t, "expected a number")
	}
	return func(p *Printing) bool {
		have, ok := get(p)
		return ok && compareNumbers(have, t.op, want)
	}, nil
}

// statTerm compares power, toughness, loyalty or their sum (pt) on any face,
// against a number or another stat of the same face (pow>tou).
func statTerm(t token, key string) (pred, error) {
	statOf := func(s stats, name string) *float64 {
		switch name {
		case "power", "pow":
			return s.power
		case "toughness", "tou":
			return s.toughness
		case "loyalty", "loy":
			return s.loyalty
		case "pt", "powtou":
			if s.power == nil || s.toughness == nil {
				return nil
			}
			sum := *s.power + *s.toughness
			return &sum
		}
		return nil
	}

	value := fold(t.value)
	var rhs func(s stats) *float64
	if n, err := strconv.ParseFloat(value, 64); err == nil {
		rhs = func(stats) *float64 { return &n }
	} else if value == "*" {
		zero := 0.0
		rhs = func(stats) *float64 { return &zero }
	} else if canonical, ok := keywordAliases[value]; ok && slices.Contains([]string{"power", "toughness", "loyalty", "pt"}, canonical) {
		rhs = func(s stats) *float64 { return statOf(s, canonical) }
	} else {
		return nil, invalidValue(t, "expected a number")
	}

	return func(p *Printing) bool {
		for _, s := range p.stats {
			l, r := statOf(s, key), rhs(s)
			if l != nil && r != nil && compareNumbers(*l, t.op, *r) {
				return true
			}
		}
		return false
	}, nil
}

func compareNumbers(a float64, op string, b float64) bool {
	switch op {
	case ":", "=":
		return a == b
	case "!=":
		return a != b
	case "<":
		return a < b
	case "<=":
		return a <= b
	case ">":
		return a > b
	case ">=":
		return a >= b
	}
	return false
}

func anyContains(list []string, sub string) bool {
	for _, s := range list {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// textMatches looks for value in each face's rules text, line by line, with
// "~" standing for the card itself (see textBlock.selves). Reminder text is
// skipped unless full.
func textMatches(blocks []textBlock, value string, full bool) bool {
	for _, b := range blocks {
		lines := b.plain
		if full {
			lines = b.lines
		}
		if !strings.Contains(value, "~") {
			if anyContains(lines, value) {
				return true
			}
			continue
		}
		for _, self := range b.selves {
			if anyContains(lines, strings.ReplaceAll(value, "~", self)) {
				return true
			}
		}
	}
	return false
}

var leadingIntPattern = regexp.MustCompile(`^\d+`)

func leadingInt(s string) (int, bool) {
	m := leadingIntPattern.FindString(s)
	if m == "" {
		return 0, false
	}
	n, err := strconv.Atoi(m)
	return n, err == nil
}

func languageCodes() []string {
	codes := []string{"zhs", "zht"}
	for _, code := range languages {
		codes = append(codes, code)
	}
	return codes
}
