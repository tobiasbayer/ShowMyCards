package api

import (
	"backend/models"
	"backend/utils"
	"log/slog"
	"strings"

	scryfall "github.com/BlueMonday/go-scryfall"
	"gorm.io/gorm"
)

// BuildCardPrices extracts pricing information from a Scryfall card into our API type.
func BuildCardPrices(prices scryfall.Prices) CardPrices {
	return CardPrices{
		USD:       prices.USD,
		USDFoil:   prices.USDFoil,
		USDEtched: prices.USDEtched,
		EUR:       prices.EUR,
		EURFoil:   prices.EURFoil,
		Tix:       prices.Tix,
	}
}

// IsEmpty reports whether no price field is set.
func (p CardPrices) IsEmpty() bool {
	return p.USD == "" && p.USDFoil == "" && p.USDEtched == "" &&
		p.EUR == "" && p.EURFoil == "" && p.Tix == ""
}

// BackfillEnglishPrices fills empty prices on non-English results from the
// English printing of the same set + collector number, using locally imported
// card data. Scryfall mostly populates prices only on the English printing, so
// non-English cards otherwise have no price to display.
//
// Best-effort: on a query error or when no English printing is found, the
// affected results are left unchanged (so they simply show no price, as before).
func BackfillEnglishPrices(db *gorm.DB, results []*CardResult) {
	// Collect prints that need a fallback: non-English, no price of their own,
	// and identifiable by set + collector number.
	var keys []models.PrintKey
	for _, r := range results {
		if r.Language == "en" || !r.Prices.IsEmpty() {
			continue
		}
		if r.SetCode == "" || r.CollectorNumber == "" {
			continue
		}
		keys = append(keys, models.PrintKey{SetCode: r.SetCode, CollectorNumber: r.CollectorNumber})
	}
	if len(keys) == 0 {
		return
	}

	pricesByPrint, err := models.GetEnglishPricesByPrint(db, keys)
	if err != nil {
		slog.Warn("english price fallback lookup failed", "component", "search", "error", err)
		return
	}

	for _, r := range results {
		if r.Language == "en" || !r.Prices.IsEmpty() {
			continue
		}
		key := models.PrintKey{SetCode: r.SetCode, CollectorNumber: r.CollectorNumber}
		if prices, ok := pricesByPrint[key.String()]; ok {
			r.Prices = BuildCardPrices(prices)
		}
	}
}

// scryfallPricesEmpty reports whether a scryfall.Prices carries no price field.
func scryfallPricesEmpty(p scryfall.Prices) bool {
	return p.USD == "" && p.USDFoil == "" && p.USDEtched == "" &&
		p.EUR == "" && p.EURFoil == "" && p.Tix == ""
}

// ResolveEnglishPrices returns effective prices keyed by Scryfall ID for the
// given cards, applying the English-printing fallback for non-English printings
// that have no price of their own. It mirrors BackfillEnglishPrices but works on
// scryfall.Prices, for callers that compute prices as floats via
// utils.ParsePriceFromScryfall (e.g. lists) rather than going through
// CardResult/CardPrices. Both paths share the same English-price lookup
// (models.GetEnglishPricesByPrint).
//
// Best-effort: on a query error or when no English printing is found, the
// affected card keeps its own (possibly empty) prices.
func ResolveEnglishPrices(db *gorm.DB, cards map[string]scryfall.Card) map[string]scryfall.Prices {
	resolved := make(map[string]scryfall.Prices, len(cards))
	for id, card := range cards {
		resolved[id] = card.Prices
	}

	// Collect prints that need a fallback: non-English, no price of their own,
	// and identifiable by set + collector number.
	var keys []models.PrintKey
	for _, card := range cards {
		if string(card.Lang) == "en" || !scryfallPricesEmpty(card.Prices) {
			continue
		}
		if card.Set == "" || card.CollectorNumber == "" {
			continue
		}
		keys = append(keys, models.PrintKey{SetCode: card.Set, CollectorNumber: card.CollectorNumber})
	}
	if len(keys) == 0 {
		return resolved
	}

	pricesByPrint, err := models.GetEnglishPricesByPrint(db, keys)
	if err != nil {
		slog.Warn("english price fallback lookup failed", "component", "lists", "error", err)
		return resolved
	}

	for id, card := range cards {
		if string(card.Lang) == "en" || !scryfallPricesEmpty(card.Prices) {
			continue
		}
		key := models.PrintKey{SetCode: card.Set, CollectorNumber: card.CollectorNumber}
		if prices, ok := pricesByPrint[key.String()]; ok {
			resolved[id] = prices
		}
	}
	return resolved
}

// BuildCardResult creates a CardResult from a Scryfall card, extracting all
// display fields and converting enum types to strings.
// Multi-face cards (transform, modal double-faced, split, adventure, ...)
// carry their names and text per face rather than on the card. These helpers
// fall back to the faces, joined in face order: names with " // " (as Scryfall
// joins the English name) and text with a "//" line.

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// joinFaces returns the non-empty values pick finds on the card's faces,
// joined with sep, or "" when there are none.
func joinFaces(card scryfall.Card, sep string, pick func(scryfall.CardFace) string) string {
	var parts []string
	for _, face := range card.CardFaces {
		if v := pick(face); v != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, sep)
}

// joinLocalizedFaces joins each face's localized value, using the face's
// English value where Scryfall has no translation (the second face of
// adventure and prepare cards often lacks one), so no face is dropped. It
// returns "" when no face is localized at all.
func joinLocalizedFaces(card scryfall.Card, sep string, localized func(scryfall.CardFace) *string, english func(scryfall.CardFace) string) string {
	var parts []string
	anyLocalized := false
	for _, face := range card.CardFaces {
		if v := deref(localized(face)); v != "" {
			parts = append(parts, v)
			anyLocalized = true
		} else if e := english(face); e != "" {
			parts = append(parts, e)
		}
	}
	if !anyLocalized {
		return ""
	}
	return strings.Join(parts, sep)
}

// cardOracleText returns the card's English Oracle text.
func cardOracleText(card scryfall.Card) string {
	if card.OracleText != "" {
		return card.OracleText
	}
	return joinFaces(card, "\n//\n", func(f scryfall.CardFace) string { return deref(f.OracleText) })
}

// cardPrintedText returns the text as printed on a non-English card, in its
// language. Scryfall leaves it unset on English cards.
func cardPrintedText(card scryfall.Card) string {
	if v := deref(card.PrintedText); v != "" {
		return v
	}
	return joinLocalizedFaces(card, "\n//\n",
		func(f scryfall.CardFace) *string { return f.PrintedText },
		func(f scryfall.CardFace) string { return deref(f.OracleText) })
}

// cardPrintedName returns the localized name of a non-English card, or nil
// when Scryfall has none (always for English cards).
func cardPrintedName(card scryfall.Card) *string {
	if v := deref(card.PrintedName); v != "" {
		return card.PrintedName
	}
	name := joinLocalizedFaces(card, " // ",
		func(f scryfall.CardFace) *string { return f.PrintedName },
		func(f scryfall.CardFace) string { return f.Name })
	if name == "" {
		return nil
	}
	return &name
}

func BuildCardResult(card scryfall.Card) CardResult {
	return CardResult{
		ID:              card.ID,
		OracleID:        card.OracleID,
		Name:            card.Name,
		PrintedName:     cardPrintedName(card),
		OracleText:      cardOracleText(card),
		PrintedText:     cardPrintedText(card),
		SetCode:         card.Set,
		SetName:         card.SetName,
		CollectorNumber: card.CollectorNumber,
		Language:        string(card.Lang),
		ColorIdentity:   utils.ConvertEnumSliceToStrings(card.ColorIdentity),
		Finishes:        utils.ConvertEnumSliceToStrings(card.Finishes),
		FrameEffects:    utils.ConvertEnumSliceToStrings(card.FrameEffects),
		PromoTypes:      card.PromoTypes,
		EDHRECRank:      card.EDHRECRank,
		Prices:          BuildCardPrices(card.Prices),
		ImageURI:        utils.ExtractCardImageURI(card),
	}
}
