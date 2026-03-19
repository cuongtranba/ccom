package main

import (
	"context"
	"fmt"
	"time"
)

// ProposalEngine handles governance tally logic.
type ProposalEngine struct {
	store *Store
}

func NewProposalEngine(store *Store) *ProposalEngine {
	return &ProposalEngine{store: store}
}

// TallyProposal computes the tally result for a proposal.
// project is used to determine the set of eligible voters (approved human peers in the project).
func (pe *ProposalEngine) TallyProposal(ctx context.Context, proposalID string, project string) (*TallyResult, error) {
	prop, err := pe.store.GetProposal(ctx, proposalID)
	if err != nil {
		return nil, fmt.Errorf("get proposal: %w", err)
	}

	votes, err := pe.store.GetProposalVotes(ctx, proposalID)
	if err != nil {
		return nil, fmt.Errorf("get votes: %w", err)
	}

	// Count eligible voters (approved human peers in project)
	peers, err := pe.store.ListPeers(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("list peers: %w", err)
	}

	humanPeerCount := 0
	for _, p := range peers {
		if p.Status == PeerStatusApproved && !p.IsAI {
			humanPeerCount++
		}
	}

	result := &TallyResult{
		TotalEligible: humanPeerCount,
	}

	// Separate human and AI votes
	humanApprove := 0
	humanReject := 0
	ownerVote := ""

	for _, v := range votes {
		if v.IsAI {
			result.AIVotes++
			continue
		}
		result.HumanVotes++
		switch v.Decision {
		case "approve":
			humanApprove++
		case "reject":
			humanReject++
		}

		// Track owner vote for veto logic
		if v.VoterPeer == prop.OwnerPeer {
			ownerVote = v.Decision
		}
	}

	result.Approve = humanApprove
	result.Reject = humanReject

	// Check quorum: >50% of human nodes have voted
	quorumThreshold := humanPeerCount / 2
	result.QuorumReached = result.HumanVotes > quorumThreshold

	// Check owner veto for trace disputes and sweep acceptance
	if (prop.Kind == ProposalTrace || prop.Kind == ProposalSweep) && ownerVote == "reject" {
		result.OwnerVetoed = true
		result.Decision = ProposalRejected
		return result, nil
	}

	// Determine decision
	if !result.QuorumReached {
		// Check if deadline has passed
		if time.Now().After(prop.Deadline) {
			result.Decision = ProposalExpired
		} else {
			result.Decision = ProposalVoting // Still waiting
		}
		return result, nil
	}

	// Simple majority of human votes
	if humanApprove > humanReject {
		result.Decision = ProposalApproved
	} else {
		// 50/50 or more rejects = rejected
		result.Decision = ProposalRejected
	}

	return result, nil
}

// ResolveProposal tallies votes and updates the proposal status.
func (pe *ProposalEngine) ResolveProposal(ctx context.Context, proposalID string, project string) (*TallyResult, error) {
	result, err := pe.TallyProposal(ctx, proposalID, project)
	if err != nil {
		return nil, err
	}

	if result.Decision == ProposalVoting {
		return result, nil // Not ready to resolve
	}

	if err := pe.store.UpdateProposalStatus(ctx, proposalID, result.Decision); err != nil {
		return nil, fmt.Errorf("update proposal status: %w", err)
	}

	return result, nil
}
