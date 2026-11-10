package cardquery

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Printing is one owned printing as the engine sees it: the card data plus
// collection facts the caller fills in for the current scope.
type Printing struct {
	*Card
	// Quantity is the number of copies in the current scope.
	Quantity int
	// Finishes are the finishes of those copies (treatments such as "foil").
	Finishes []string
	// Free is the number of copies of this card (oracle) free for decks.
	Free int
	// AddedAt is when the newest copy in scope was added.
	AddedAt time.Time
}

// Prices are a printing's prices. USD and EUR fall back to the foil and then
// the etched price, as Scryfall does for foil-only printings. Nil means no price.
type Prices struct {
	USD *float64
	EUR *float64
	Tix *float64
}

func (p Prices) byKey(key string) *float64 {
	switch key {
	case "usd":
		return p.USD
	case "eur":
		return p.EUR
	case "tix":
		return p.Tix
	}
	return nil
}

// PricesFrom builds Prices from Scryfall's price strings ("" means none).
func PricesFrom(usd, usdFoil, usdEtched, eur, eurFoil, tix string) Prices {
	return Prices{
		USD: firstPrice(usd, usdFoil, usdEtched),
		EUR: firstPrice(eur, eurFoil),
		Tix: firstPrice(tix),
	}
}

func firstPrice(values ...string) *float64 {
	for _, v := range values {
		if v == "" {
			continue
		}
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return &f
		}
	}
	return nil
}

// Card is the searchable view of one printing, decoded from Scryfall card JSON.
// Text fields are kept folded (lowercase, no accents) for matching.
type Card struct {
	ID              string
	OracleID        string
	Name            string
	Lang            string
	Layout          string
	Set             string
	CollectorNumber string
	Rarity          string
	Artist          string
	CMC             float64
	ReleasedAt      string
	EDHRECRank      *int
	Prices          Prices
	Legalities      map[string]string
	PrintFinishes   []string
	Keywords        []string // folded
	Promo           bool
	Reprint         bool
	FullArt         bool
	Reserved        bool
	Digital         bool
	Watermark       string // folded
	BorderColor     string
	Frame           string
	FrameEffects    []string

	colors        colorSet
	colorIdentity colorSet
	isMeldResult  bool

	names   []string // name, printed and flavor names, per face too
	types   []string // type lines, English and printed
	texts   []textBlock
	flavors []string
	artists []string
	costs   []manaCost
	stats   []stats
	front   string // folded type line of the front face, for is:commander
}

// textBlock is one face's rules text, English or printed, split into lines.
type textBlock struct {
	selves []string // what "~" stands for: the face's name, short name, "this creature", ...
	lines  []string // folded lines, reminder text kept
	plain  []string // folded lines, reminder text removed
}

// selfReferences are how current Oracle text names the card itself. Scryfall
// matches them for "~", as it does a legendary card's short name ("Kamahl"
// for "Kamahl, Pit Fighter").
var selfReferences = []string{
	"this creature", "this spell", "this artifact", "this enchantment",
	"this land", "this permanent", "this card", "this aura", "this equipment",
	"this vehicle", "this planeswalker", "this battle", "this saga",
	"this siege", "this class", "this case", "this room", "this token",
}

// stats are one face's power, toughness and loyalty; nil when absent.
type stats struct {
	power, toughness, loyalty *float64
}

type rawFace struct {
	Name            string    `json:"name"`
	PrintedName     string    `json:"printed_name"`
	FlavorName      string    `json:"flavor_name"`
	TypeLine        string    `json:"type_line"`
	PrintedTypeLine string    `json:"printed_type_line"`
	OracleText      string    `json:"oracle_text"`
	PrintedText     string    `json:"printed_text"`
	FlavorText      string    `json:"flavor_text"`
	ManaCost        string    `json:"mana_cost"`
	Power           *string   `json:"power"`
	Toughness       *string   `json:"toughness"`
	Loyalty         *string   `json:"loyalty"`
	Colors          *[]string `json:"colors"`
	Artist          string    `json:"artist"`
	Watermark       string    `json:"watermark"`
}

type rawCard struct {
	rawFace
	ID            string            `json:"id"`
	OracleID      string            `json:"oracle_id"`
	Lang          string            `json:"lang"`
	Layout        string            `json:"layout"`
	CMC           float64           `json:"cmc"`
	ColorIdentity []string          `json:"color_identity"`
	Keywords      []string          `json:"keywords"`
	Set           string            `json:"set"`
	Collector     string            `json:"collector_number"`
	Rarity        string            `json:"rarity"`
	ReleasedAt    string            `json:"released_at"`
	Legalities    map[string]string `json:"legalities"`
	Finishes      []string          `json:"finishes"`
	Promo         bool              `json:"promo"`
	Reprint       bool              `json:"reprint"`
	FullArt       bool              `json:"full_art"`
	Reserved      bool              `json:"reserved"`
	Digital       bool              `json:"digital"`
	BorderColor   string            `json:"border_color"`
	Frame         string            `json:"frame"`
	FrameEffects  []string          `json:"frame_effects"`
	EDHRECRank    *int              `json:"edhrec_rank"`
	Prices        struct {
		USD       string `json:"usd"`
		USDFoil   string `json:"usd_foil"`
		USDEtched string `json:"usd_etched"`
		EUR       string `json:"eur"`
		EURFoil   string `json:"eur_foil"`
		Tix       string `json:"tix"`
	} `json:"prices"`
	AllParts []struct {
		ID        string `json:"id"`
		Component string `json:"component"`
	} `json:"all_parts"`
	CardFaces []rawFace `json:"card_faces"`
}

// Decode builds a Card from Scryfall card JSON, as stored in cards.raw_json.
func Decode(raw []byte) (*Card, error) {
	var r rawCard
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("decoding card JSON: %w", err)
	}

	c := &Card{
		ID:              r.ID,
		OracleID:        r.OracleID,
		Name:            r.Name,
		Lang:            r.Lang,
		Layout:          r.Layout,
		Set:             strings.ToLower(r.Set),
		CollectorNumber: r.Collector,
		Rarity:          r.Rarity,
		Artist:          r.Artist,
		CMC:             r.CMC,
		ReleasedAt:      r.ReleasedAt,
		EDHRECRank:      r.EDHRECRank,
		Prices:          PricesFrom(r.Prices.USD, r.Prices.USDFoil, r.Prices.USDEtched, r.Prices.EUR, r.Prices.EURFoil, r.Prices.Tix),
		Legalities:      r.Legalities,
		PrintFinishes:   r.Finishes,
		Promo:           r.Promo,
		Reprint:         r.Reprint,
		FullArt:         r.FullArt,
		Reserved:        r.Reserved,
		Digital:         r.Digital,
		Watermark:       fold(r.Watermark),
		BorderColor:     r.BorderColor,
		Frame:           r.Frame,
		FrameEffects:    r.FrameEffects,
		colorIdentity:   colorSetOf(r.ColorIdentity),
	}
	for _, kw := range r.Keywords {
		c.Keywords = append(c.Keywords, fold(kw))
	}
	for _, part := range r.AllParts {
		if part.Component == "meld_result" && part.ID == r.ID {
			c.isMeldResult = true
		}
	}

	// Colours: the card's, or the front face's on two-faced cards, which
	// carry colours per face only.
	switch {
	case r.Colors != nil:
		c.colors = colorSetOf(*r.Colors)
	case len(r.CardFaces) > 0 && r.CardFaces[0].Colors != nil:
		c.colors = colorSetOf(*r.CardFaces[0].Colors)
	}

	c.front = fold(r.TypeLine)
	if len(r.CardFaces) > 0 && r.CardFaces[0].TypeLine != "" {
		c.front = fold(r.CardFaces[0].TypeLine)
	}

	// The card itself and then each face; the card-level values of a
	// multi-face card are either empty or joined from its faces.
	// A multi-face card's own mana cost joins its faces' costs ("{1}{R} //
	// {1}{U}"), so only the faces' costs are compared.
	c.addFace(r.rawFace, len(r.CardFaces) == 0)
	for _, f := range r.CardFaces {
		c.addFace(f, true)
	}
	return c, nil
}

func (c *Card) addFace(f rawFace, withCost bool) {
	c.names = appendFolded(c.names, f.Name, f.PrintedName, f.FlavorName)
	c.types = appendFolded(c.types, f.TypeLine, f.PrintedTypeLine)
	c.flavors = appendFolded(c.flavors, f.FlavorText)
	c.artists = appendFolded(c.artists, f.Artist)

	if f.OracleText != "" {
		c.texts = append(c.texts, newTextBlock(f.Name, f.OracleText))
	}
	if f.PrintedText != "" {
		name := f.PrintedName
		if name == "" {
			name = f.Name
		}
		c.texts = append(c.texts, newTextBlock(name, f.PrintedText))
	}
	if withCost && f.ManaCost != "" {
		if cost, err := parseManaCost(f.ManaCost); err == nil {
			c.costs = append(c.costs, cost)
		}
	}
	s := stats{power: statValue(f.Power), toughness: statValue(f.Toughness), loyalty: statValue(f.Loyalty)}
	if s.power != nil || s.toughness != nil || s.loyalty != nil {
		c.stats = append(c.stats, s)
	}
}

func appendFolded(list []string, values ...string) []string {
	for _, v := range values {
		if v != "" {
			list = append(list, fold(v))
		}
	}
	return list
}

var reminderText = regexp.MustCompile(`\([^)]*\)`)

func newTextBlock(name, text string) textBlock {
	name = fold(name)
	b := textBlock{selves: append([]string{name}, selfReferences...)}
	if short, _, ok := strings.Cut(name, ","); ok {
		b.selves = append(b.selves, short)
	}
	for _, line := range strings.Split(fold(text), "\n") {
		b.lines = append(b.lines, line)
		b.plain = append(b.plain, reminderText.ReplaceAllString(line, ""))
	}
	return b
}

// statValue reads power, toughness or loyalty: "*" counts as 0 and "2+*" as 2,
// as on Scryfall. Nil means the face has no such value.
func statValue(s *string) *float64 {
	if s == nil || *s == "" {
		return nil
	}
	v := leadingNumber(*s)
	return &v
}

var leadingNumberPattern = regexp.MustCompile(`^[+-]?\d+(\.\d+)?`)

func leadingNumber(s string) float64 {
	m := leadingNumberPattern.FindString(s)
	if m == "" {
		return 0
	}
	v, err := strconv.ParseFloat(m, 64)
	if err != nil {
		return 0
	}
	return v
}

// releaseYear is the year of released_at, or 0 when unknown.
func (c *Card) releaseYear() int {
	if len(c.ReleasedAt) < 4 {
		return 0
	}
	y, err := strconv.Atoi(c.ReleasedAt[:4])
	if err != nil {
		return 0
	}
	return y
}
