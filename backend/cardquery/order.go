package cardquery

import (
	"cmp"
	"slices"
)

// sortValue is one printing's value for an order: key. Missing values sort
// last in either direction.
type sortValue struct {
	num     float64
	text    string
	missing bool
}

// orderKeys are the supported order: values and how to read them.
var orderKeys = map[string]func(p *Printing) sortValue{
	"name":     func(p *Printing) sortValue { return sortValue{text: fold(p.Name)} },
	"set":      func(p *Printing) sortValue { return sortValue{text: p.Set} },
	"released": func(p *Printing) sortValue { return sortValue{text: p.ReleasedAt, missing: p.ReleasedAt == ""} },
	"rarity": func(p *Printing) sortValue {
		r, ok := rarityRank[p.Rarity]
		return sortValue{num: float64(r), missing: !ok}
	},
	"color":     func(p *Printing) sortValue { return sortValue{num: float64(colorOrder(p.colors))} },
	"usd":       priceOrder("usd"),
	"eur":       priceOrder("eur"),
	"tix":       priceOrder("tix"),
	"cmc":       func(p *Printing) sortValue { return sortValue{num: p.CMC} },
	"mv":        func(p *Printing) sortValue { return sortValue{num: p.CMC} },
	"power":     statOrder(func(s stats) *float64 { return s.power }),
	"toughness": statOrder(func(s stats) *float64 { return s.toughness }),
	"edhrec": func(p *Printing) sortValue {
		if p.EDHRECRank == nil {
			return sortValue{missing: true}
		}
		return sortValue{num: float64(*p.EDHRECRank)}
	},
	"artist": func(p *Printing) sortValue { return sortValue{text: fold(p.Artist), missing: p.Artist == ""} },
}

func priceOrder(key string) func(p *Printing) sortValue {
	return func(p *Printing) sortValue {
		price := p.price(key)
		if price == nil {
			return sortValue{missing: true}
		}
		return sortValue{num: *price}
	}
}

func statOrder(get func(stats) *float64) func(p *Printing) sortValue {
	return func(p *Printing) sortValue {
		for _, s := range p.stats {
			if v := get(s); v != nil {
				return sortValue{num: *v}
			}
		}
		return sortValue{missing: true}
	}
}

// Sort orders printings by the query's order: and direction:. Without
// order:, the newest added come first. Ties go by name, set and number.
func (q *Query) Sort(ps []*Printing) {
	key := orderKeys[q.order]
	desc := q.direction == "desc" || (q.direction != "asc" && q.order == "released")

	slices.SortStableFunc(ps, func(a, b *Printing) int {
		if key == nil {
			if c := b.AddedAt.Compare(a.AddedAt); c != 0 {
				return c
			}
			return tieBreak(a, b)
		}
		va, vb := key(a), key(b)
		switch {
		case va.missing && vb.missing:
			return tieBreak(a, b)
		case va.missing:
			return 1
		case vb.missing:
			return -1
		}
		c := cmp.Or(cmp.Compare(va.num, vb.num), cmp.Compare(va.text, vb.text))
		if desc {
			c = -c
		}
		if c != 0 {
			return c
		}
		return tieBreak(a, b)
	})
}

func tieBreak(a, b *Printing) int {
	na, _ := leadingInt(a.CollectorNumber)
	nb, _ := leadingInt(b.CollectorNumber)
	return cmp.Or(
		cmp.Compare(fold(a.Name), fold(b.Name)),
		cmp.Compare(a.Set, b.Set),
		cmp.Compare(na, nb),
		cmp.Compare(a.CollectorNumber, b.CollectorNumber),
	)
}
