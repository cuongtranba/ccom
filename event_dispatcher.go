package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// EventDispatcher persists events to SQLite and logs them.
type EventDispatcher struct {
	store  *Store
	logger zerolog.Logger
}

// NewEventDispatcher creates a new EventDispatcher backed by the given store.
func NewEventDispatcher(store *Store, logger zerolog.Logger) *EventDispatcher {
	return &EventDispatcher{store: store, logger: logger}
}

// Dispatch marshals, persists, and logs a NodeEvent.
func (d *EventDispatcher) Dispatch(ctx context.Context, event NodeEvent) error {
	payloadJSON, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}

	stored := &StoredEvent{
		ID:      uuid.New().String(),
		Kind:    event.Kind,
		Payload: string(payloadJSON),
		Urgent:  event.Urgent,
		Read:    false,
	}

	if err := d.store.SaveEvent(ctx, stored); err != nil {
		return fmt.Errorf("save event: %w", err)
	}

	d.logger.Info().
		Str("event_id", stored.ID).
		Str("kind", string(event.Kind)).
		Bool("urgent", event.Urgent).
		Msg("event dispatched")

	return nil
}
