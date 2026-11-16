package services

import (
	"backend/models"
	"backend/rules"
	"context"
	"errors"
	"fmt"
	"log/slog"

	"gorm.io/gorm"
)

// AutoSortService evaluates sorting rules to determine storage locations for cards.
type AutoSortService struct {
	db *gorm.DB
}

// NewAutoSortService creates a new auto-sort service.
func NewAutoSortService(db *gorm.DB) *AutoSortService {
	return &AutoSortService{db: db}
}

// ErrCardNotInCatalog means the card isn't in the local catalog (the bulk data),
// so the sorting rules can't be evaluated for it.
var ErrCardNotInCatalog = errors.New("card not in the local catalog")

// ErrNoMatchingRule means no enabled sorting rule matched the card.
var ErrNoMatchingRule = rules.ErrNoMatchingRule

// DetermineStorageLocation evaluates sorting rules for a card and returns the
// matched storage location ID. Errors wrap ErrCardNotInCatalog when the card is
// unknown and ErrNoMatchingRule when no rule matches; anything else is a failure.
func (s *AutoSortService) DetermineStorageLocation(ctx context.Context, scryfallID, treatment string) (*uint, error) {
	var card models.Card
	if err := s.db.WithContext(ctx).Where("scryfall_id = ?", scryfallID).First(&card).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("card %s: %w", scryfallID, ErrCardNotInCatalog)
		}
		return nil, fmt.Errorf("card lookup failed: %w", err)
	}

	cardData, err := rules.RawJSONToRuleData(card.RawJSON, treatment)
	if err != nil {
		return nil, fmt.Errorf("card data conversion failed: %w", err)
	}

	evaluator := rules.NewEvaluator(s.db)
	location, err := evaluator.EvaluateCard(ctx, cardData)
	if err != nil {
		return nil, fmt.Errorf("evaluate sorting rules: %w", err)
	}

	slog.Info("card matched rule, assigning to storage location",
		"component", "auto_sort",
		"scryfall_id", scryfallID,
		"storage_location_id", location.ID,
		"storage_location_name", location.Name,
	)

	return &location.ID, nil
}
