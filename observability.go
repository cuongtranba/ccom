package main

import (
	"context"
	"fmt"
	"time"
)

// HealthStatus is the machine-readable health output for `inv network health`.
type HealthStatus struct {
	PeerID           string `json:"peer_id"`
	UptimeSeconds    int    `json:"uptime_seconds"`
	ConnectedPeers   int    `json:"connected_peers"`
	PendingPeers     int    `json:"pending_peers"`
	OutboxDepth      int    `json:"outbox_depth"`
	ActiveProposals  int    `json:"active_proposals"`
	ActiveChallenges int    `json:"active_challenges"`
	Reputation       int    `json:"reputation"`
	ThrottledPeers   int    `json:"throttled_peers"`
}

// AlertKind identifies the type of observability alert.
type AlertKind string

const (
	AlertOutboxBacklog     AlertKind = "alert.outbox_backlog"
	AlertPeerLost          AlertKind = "alert.peer_lost"
	AlertReputationLow     AlertKind = "alert.reputation_low"
	AlertChallengeDeadline AlertKind = "alert.challenge_deadline"
	AlertProposalDeadline  AlertKind = "alert.proposal_deadline"
	AlertRateLimited       AlertKind = "alert.rate_limited"
	AlertMembershipPending AlertKind = "alert.membership_pending"
)

// Alert represents an observability alert event.
type Alert struct {
	Kind    AlertKind `json:"kind"`
	Message string    `json:"message"`
	Level   string    `json:"level"`
}

// BuildHealthStatus gathers current node health metrics from the store.
func BuildHealthStatus(ctx context.Context, store *Store, peerID, project string, startTime time.Time) (*HealthStatus, error) {
	peers, err := store.ListPeers(ctx, project)
	if err != nil {
		return nil, err
	}

	approvedCount := 0
	pendingCount := 0
	for _, p := range peers {
		if p.Status == PeerStatusApproved {
			approvedCount++
		} else if p.Status == PeerStatusPending {
			pendingCount++
		}
	}

	outboxDepth, err := store.OutboxDepth(ctx)
	if err != nil {
		return nil, err
	}

	activeProposals, _ := store.ListAllActiveProposals(ctx)
	activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

	reputation, _ := store.GetPeerReputation(ctx, peerID)

	return &HealthStatus{
		PeerID:           peerID,
		UptimeSeconds:    int(time.Since(startTime).Seconds()),
		ConnectedPeers:   approvedCount,
		PendingPeers:     pendingCount,
		OutboxDepth:      outboxDepth,
		ActiveProposals:  len(activeProposals),
		ActiveChallenges: len(activeChallenges),
		Reputation:       reputation,
	}, nil
}

// CheckAlerts generates alerts based on current node state.
func CheckAlerts(ctx context.Context, store *Store, cfg *NodeConfig, peerID, project string) ([]Alert, error) {
	var alerts []Alert

	// Check outbox backlog
	outboxDepth, err := store.OutboxDepth(ctx)
	if err != nil {
		return nil, err
	}
	if outboxDepth > cfg.Observability.AlertOutboxThreshold {
		alerts = append(alerts, Alert{
			Kind:    AlertOutboxBacklog,
			Message: fmt.Sprintf("Outbox depth %d exceeds threshold %d", outboxDepth, cfg.Observability.AlertOutboxThreshold),
			Level:   "warn",
		})
	}

	// Check reputation
	reputation, _ := store.GetPeerReputation(ctx, peerID)
	if reputation < cfg.Observability.AlertReputationThreshold {
		alerts = append(alerts, Alert{
			Kind:    AlertReputationLow,
			Message: fmt.Sprintf("Reputation %d below threshold %d", reputation, cfg.Observability.AlertReputationThreshold),
			Level:   "error",
		})
	}

	// Check challenges nearing deadline
	openChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)
	for _, ch := range openChallenges {
		if ch.ChallengedPeer == peerID {
			remaining := time.Until(ch.Deadline)
			if remaining < cfg.Observability.AlertDeadlineWarning && remaining > 0 {
				alerts = append(alerts, Alert{
					Kind:    AlertChallengeDeadline,
					Message: fmt.Sprintf("Challenge %s deadline in %s, no response", ch.ID[:8], remaining.Truncate(time.Minute)),
					Level:   "error",
				})
			}
		}
	}

	// Check proposals nearing deadline
	activeProposals, _ := store.ListAllActiveProposals(ctx)
	for _, p := range activeProposals {
		remaining := time.Until(p.Deadline)
		if remaining < cfg.Observability.AlertDeadlineWarning && remaining > 0 {
			alerts = append(alerts, Alert{
				Kind:    AlertProposalDeadline,
				Message: fmt.Sprintf("Proposal %s deadline in %s", p.ID[:8], remaining.Truncate(time.Minute)),
				Level:   "warn",
			})
		}
	}

	// Check pending peers over 24h
	peers, _ := store.ListPeers(ctx, project)
	for _, p := range peers {
		if p.Status == PeerStatusPending && p.LastSeen != nil {
			if time.Since(*p.LastSeen) > 24*time.Hour {
				alerts = append(alerts, Alert{
					Kind:    AlertMembershipPending,
					Message: fmt.Sprintf("Peer %s awaiting approval for >24h", p.Name),
					Level:   "warn",
				})
			}
		}
	}

	return alerts, nil
}
