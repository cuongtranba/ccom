package main

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type SignalPropagator struct {
	store        *Store
	stateMachine *StateMachine
}

func NewSignalPropagator(store *Store, sm *StateMachine) *SignalPropagator {
	return &SignalPropagator{store: store, stateMachine: sm}
}

func (sp *SignalPropagator) PropagateChange(ctx context.Context, changedItemID string) ([]Signal, error) {
	visited := make(map[string]bool)
	return sp.propagateChangeInner(ctx, changedItemID, visited)
}

func (sp *SignalPropagator) propagateChangeInner(ctx context.Context, changedItemID string, visited map[string]bool) ([]Signal, error) {
	if visited[changedItemID] {
		return nil, nil
	}
	visited[changedItemID] = true

	item, err := sp.store.GetItem(ctx, changedItemID)
	if err != nil {
		return nil, fmt.Errorf("get changed item: %w", err)
	}

	dependents, err := sp.store.GetDependentTraces(ctx, changedItemID)
	if err != nil {
		return nil, fmt.Errorf("get dependent traces: %w", err)
	}

	var signals []Signal
	for _, trace := range dependents {
		if visited[trace.FromItemID] {
			continue
		}

		targetItem, err := sp.store.GetItem(ctx, trace.FromItemID)
		if err != nil {
			return nil, fmt.Errorf("get target item %s: %w", trace.FromItemID, err)
		}

		if targetItem.Status != StatusProven {
			continue
		}

		sig := Signal{
			ID:         uuid.New().String(),
			Kind:       SignalChange,
			SourceItem: changedItemID,
			SourceNode: item.NodeID,
			TargetItem: trace.FromItemID,
			TargetNode: targetItem.NodeID,
			Payload:    fmt.Sprintf("Item %q changed in node %s", item.Title, item.NodeID),
			CreatedAt:  time.Now(),
		}

		if err := sp.store.CreateSignal(ctx, &sig); err != nil {
			return nil, fmt.Errorf("create signal: %w", err)
		}

		now := time.Now()
		transition := Transition{
			Kind:      TransitionSuspect,
			From:      targetItem.Status,
			To:        StatusSuspect,
			Reason:    fmt.Sprintf("Upstream item %q (%s) changed", item.Title, item.ID),
			Actor:     "system:signal-propagator",
			Timestamp: now,
		}

		newStatus, err := sp.stateMachine.Apply(transition)
		if err != nil {
			return nil, fmt.Errorf("apply transition for %s: %w", targetItem.ID, err)
		}

		if err := sp.store.UpdateItemStatus(ctx, targetItem.ID, newStatus); err != nil {
			return nil, fmt.Errorf("update item status: %w", err)
		}

		if err := sp.store.RecordTransition(ctx, targetItem.ID, &transition); err != nil {
			return nil, fmt.Errorf("record transition: %w", err)
		}

		sig.Processed = true
		if err := sp.store.MarkSignalProcessed(ctx, sig.ID); err != nil {
			return nil, fmt.Errorf("mark signal processed: %w", err)
		}

		signals = append(signals, sig)

		deeper, err := sp.propagateChangeInner(ctx, targetItem.ID, visited)
		if err != nil {
			return nil, fmt.Errorf("deep propagation from %s: %w", targetItem.ID, err)
		}
		signals = append(signals, deeper...)
	}

	return signals, nil
}

func (sp *SignalPropagator) DetectSuspect(ctx context.Context, nodeID string) ([]Item, error) {
	items, err := sp.store.GetItemsByNodeAndStatus(ctx, nodeID, StatusSuspect)
	if err != nil {
		return nil, fmt.Errorf("get suspect items: %w", err)
	}
	return items, nil
}

func (sp *SignalPropagator) ComputeImpact(ctx context.Context, itemID string) ([]Item, error) {
	visited := make(map[string]bool)
	return sp.collectImpact(ctx, itemID, visited)
}

func (sp *SignalPropagator) collectImpact(ctx context.Context, itemID string, visited map[string]bool) ([]Item, error) {
	if visited[itemID] {
		return nil, nil
	}
	visited[itemID] = true

	dependents, err := sp.store.GetDependentTraces(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var affected []Item
	for _, trace := range dependents {
		if visited[trace.FromItemID] {
			continue
		}

		item, err := sp.store.GetItem(ctx, trace.FromItemID)
		if err != nil {
			return nil, err
		}
		affected = append(affected, *item)

		deeper, err := sp.collectImpact(ctx, trace.FromItemID, visited)
		if err != nil {
			return nil, err
		}
		affected = append(affected, deeper...)
	}
	return affected, nil
}
