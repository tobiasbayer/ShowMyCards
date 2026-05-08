package utils

import (
	"strconv"

	scryfall "github.com/BlueMonday/go-scryfall"
)

// Currency identifies a price field set on scryfall.Prices.
type Currency string

const (
	CurrencyUSD Currency = "usd"
	CurrencyEUR Currency = "eur"
)

// ParsePriceFromScryfall extracts the price for a specific treatment and
// currency from scryfall.Prices. Scryfall does not publish an EUR etched
// price, so EUR etched falls back to EUR foil (mirrors the frontend
// PriceLozenge behavior). Falls back to the nonfoil price in the same
// currency when a treatment-specific value is unavailable.
func ParsePriceFromScryfall(prices scryfall.Prices, treatment string, c Currency) float64 {
	// Map treatment to Scryfall price field for the requested currency.
	var priceStr, nonfoilFallback string
	switch c {
	case CurrencyEUR:
		nonfoilFallback = prices.EUR
		switch treatment {
		case "foil":
			priceStr = prices.EURFoil
		case "etched":
			priceStr = prices.EURFoil
		case "nonfoil":
			priceStr = prices.EUR
		default:
			priceStr = prices.EURFoil
		}
	default:
		nonfoilFallback = prices.USD
		switch treatment {
		case "foil":
			priceStr = prices.USDFoil
		case "etched":
			priceStr = prices.USDEtched
		case "nonfoil":
			priceStr = prices.USD
		default:
			// For other treatments (glossy, etc.), try foil first
			priceStr = prices.USDFoil
		}
	}

	// Parse the price string to float64
	if priceStr != "" {
		if price, err := strconv.ParseFloat(priceStr, 64); err == nil {
			return price
		}
	}

	// Fallback to nonfoil price if treatment-specific price not available
	if treatment != "nonfoil" && nonfoilFallback != "" {
		if price, err := strconv.ParseFloat(nonfoilFallback, 64); err == nil {
			return price
		}
	}

	return 0.0
}
