package main

import (
	"context"
	"fmt"
	"time"
)

// ChallengeEngine handles challenge lifecycle: create, respond, vote, resolve.
type ChallengeEngine struct {
	store     *Store
	proposals *ProposalEngine
}

func NewChallengeEngine(store *Store, proposals *ProposalEngine) *ChallengeEngine {
	return &ChallengeEngine{store: store, proposals: proposals}
}

// CreateChallenge files a new challenge against a peer.
func (ce *ChallengeEngine) CreateChallenge(
	ctx context.Context,
	kind ChallengeKind,
	challengerPeer, challengedPeer string,
	targetItemID, targetTraceID string,
	reason, evidence string,
	deadlineDuration time.Duration,
) (*Challenge, error) {
	// Validate: no self-challenge
	if challengerPeer == challengedPeer {
		return nil, fmt.Errorf("self-challenge not allowed")
	}

	// Check reputation floor
	score, err := ce.store.GetPeerReputation(ctx, challengerPeer)
	if err != nil {
		return nil, fmt.Errorf("get reputation: %w", err)
	}
	if score <= -10 {
		return nil, fmt.Errorf("challenger reputation at floor (-10): challenges auto-rejected")
	}

	// Check cooldown
	onCooldown, err := ce.store.IsOnChallengeCooldown(ctx, challengerPeer, challengedPeer, 24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("check cooldown: %w", err)
	}
	if onCooldown {
		return nil, fmt.Errorf("cooldown active: cannot challenge same peer within 24h")
	}

	ch := &Challenge{
		Kind:           kind,
		ChallengerPeer: challengerPeer,
		ChallengedPeer: challengedPeer,
		TargetItemID:   targetItemID,
		TargetTraceID:  targetTraceID,
		Reason:         reason,
		Evidence:       evidence,
		Deadline:       time.Now().Add(deadlineDuration),
	}

	if err := ce.store.CreateChallenge(ctx, ch); err != nil {
		return nil, fmt.Errorf("create challenge: %w", err)
	}

	// Record cooldown
	if err := ce.store.SetChallengeCooldown(ctx, challengerPeer, challengedPeer); err != nil {
		return nil, fmt.Errorf("set cooldown: %w", err)
	}

	return ch, nil
}

// RespondToChallenge allows the challenged node to submit evidence.
func (ce *ChallengeEngine) RespondToChallenge(ctx context.Context, challengeID, evidence string) error {
	ch, err := ce.store.GetChallenge(ctx, challengeID)
	if err != nil {
		return fmt.Errorf("get challenge: %w", err)
	}
	if ch.Status != ChallengeOpen {
		return fmt.Errorf("challenge %s is %s, not open", challengeID, ch.Status)
	}

	if err := ce.store.UpdateChallengeResponse(ctx, challengeID, evidence, ChallengeResponded); err != nil {
		return fmt.Errorf("update response: %w", err)
	}

	return nil
}

// ResolveChallenge tallies votes and determines the outcome.
// For simplicity, it uses the proposal engine with a challenge proposal.
func (ce *ChallengeEngine) ResolveChallenge(ctx context.Context, challengeID, project string) (*Challenge, error) {
	ch, err := ce.store.GetChallenge(ctx, challengeID)
	if err != nil {
		return nil, fmt.Errorf("get challenge: %w", err)
	}

	// Check for expiry
	if time.Now().After(ch.Deadline) && ch.Status == ChallengeOpen {
		return ce.expireChallenge(ctx, ch)
	}

	// For responded challenges, look at vote pattern
	// Count votes from proposal_votes linked to this challenge's proposal
	proposals, err := ce.store.ListProposals(ctx, ProposalVoting)
	if err != nil {
		return nil, fmt.Errorf("list proposals: %w", err)
	}

	// Find the challenge proposal
	var challengeProp *Proposal
	for i := range proposals {
		if proposals[i].Kind == ProposalChallenge {
			for _, item := range proposals[i].AffectedItems {
				if item == challengeID {
					challengeProp = &proposals[i]
					break
				}
			}
		}
	}

	if challengeProp != nil {
		result, err := ce.proposals.TallyProposal(ctx, challengeProp.ID, project)
		if err != nil {
			return nil, fmt.Errorf("tally challenge proposal: %w", err)
		}

		if result.Decision == ProposalApproved {
			// Sustained: penalty applied
			ch.Status = ChallengeSustained
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
			ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -1)
		} else if result.Decision == ProposalRejected {
			// Dismissed: challenger penalized
			ch.Status = ChallengeDismissed
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, -1)
		} else {
			return ch, nil // Still voting
		}
	} else {
		// No proposal found — resolve based on response status
		// If responded and deadline passed, treat as sustained by default
		if ch.Status == ChallengeResponded {
			ch.Status = ChallengeSustained
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
			ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -1)
		} else {
			return ch, nil
		}
	}

	if err := ce.store.ResolveChallengeStatus(ctx, challengeID, ch.Status); err != nil {
		return nil, fmt.Errorf("resolve challenge: %w", err)
	}

	return ch, nil
}

// expireChallenge applies auto-penalty when no response was given by deadline.
func (ce *ChallengeEngine) expireChallenge(ctx context.Context, ch *Challenge) (*Challenge, error) {
	ch.Status = ChallengeExpired

	// Auto-penalty: challenger +1, challenged -2
	ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
	ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -2)

	if err := ce.store.ResolveChallengeStatus(ctx, ch.ID, ChallengeExpired); err != nil {
		return nil, fmt.Errorf("expire challenge: %w", err)
	}

	return ch, nil
}

// ProcessExpiredChallenges finds and expires all open challenges past their deadline.
func (ce *ChallengeEngine) ProcessExpiredChallenges(ctx context.Context) ([]Challenge, error) {
	openChallenges, err := ce.store.ListChallenges(ctx, ChallengeOpen)
	if err != nil {
		return nil, fmt.Errorf("list open challenges: %w", err)
	}

	var expired []Challenge
	for _, ch := range openChallenges {
		if time.Now().After(ch.Deadline) {
			result, err := ce.expireChallenge(ctx, &ch)
			if err != nil {
				continue
			}
			expired = append(expired, *result)
		}
	}

	return expired, nil
}
