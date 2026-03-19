package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type ProposalSuite struct {
	suite.Suite
	store    *Store
	proposer *ProposalEngine
}

func (s *ProposalSuite) SetupTest() {
	tmpDir := s.T().TempDir()
	var err error
	s.store, err = NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.proposer = NewProposalEngine(s.store)
}

func (s *ProposalSuite) TearDownTest() {
	s.store.Close()
}

func (s *ProposalSuite) seedPeers(humanCount, aiCount int) {
	ctx := context.Background()
	for i := 0; i < humanCount; i++ {
		p := &Peer{
			PeerID:   fmt.Sprintf("human-peer-%d", i),
			NodeID:   fmt.Sprintf("human-node-%d", i),
			Name:     fmt.Sprintf("human-%d", i),
			Vertical: VerticalDev,
			Project:  "test-proj",
			Owner:    fmt.Sprintf("owner-%d", i),
			IsAI:     false,
			Status:   PeerStatusApproved,
		}
		s.store.CreatePeer(ctx, p)
	}
	for i := 0; i < aiCount; i++ {
		p := &Peer{
			PeerID:   fmt.Sprintf("ai-peer-%d", i),
			NodeID:   fmt.Sprintf("ai-node-%d", i),
			Name:     fmt.Sprintf("ai-%d", i),
			Vertical: VerticalDev,
			Project:  "test-proj",
			Owner:    fmt.Sprintf("ai-owner-%d", i),
			IsAI:     true,
			Status:   PeerStatusApproved,
		}
		s.store.CreatePeer(ctx, p)
	}
}

func (s *ProposalSuite) TestTally_QuorumReached_Approved() {
	ctx := context.Background()
	s.seedPeers(4, 1) // 4 human, 1 AI

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Test CR",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 of 4 humans approve (>50%)
	for i := 1; i <= 3; i++ {
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID,
			VoterPeer:  fmt.Sprintf("human-peer-%d", i),
			VoterID:    fmt.Sprintf("voter-%d", i),
			Decision:   "approve",
		})
	}

	// AI also votes approve (should not count toward quorum)
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID,
		VoterPeer:  "ai-peer-0",
		VoterID:    "ai-voter-0",
		Decision:   "approve",
		IsAI:       true,
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.True(result.QuorumReached)
	s.Equal(ProposalApproved, result.Decision)
	s.Equal(3, result.HumanVotes)
	s.Equal(1, result.AIVotes)
	s.Equal(4, result.TotalEligible)
}

func (s *ProposalSuite) TestTally_QuorumReached_Rejected() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Test CR Reject",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 of 4 humans reject
	for i := 1; i <= 3; i++ {
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID,
			VoterPeer:  fmt.Sprintf("human-peer-%d", i),
			VoterID:    fmt.Sprintf("voter-%d", i),
			Decision:   "reject",
		})
	}

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.True(result.QuorumReached)
	s.Equal(ProposalRejected, result.Decision)
}

func (s *ProposalSuite) TestTally_5050Split_Rejected() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Split Vote",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 2 approve, 2 reject
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-2", VoterID: "v2", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-3", VoterID: "v3", Decision: "reject",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-0", VoterID: "v0", Decision: "reject",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.Equal(ProposalRejected, result.Decision) // No majority = rejected
}

func (s *ProposalSuite) TestTally_OwnerVeto_TraceDispute() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalTrace,
		Title:        "Trace dispute",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		OwnerPeer:    "human-peer-1", // Owner node
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 approve but owner rejects
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "reject", // Owner vetoes
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-2", VoterID: "v2", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-3", VoterID: "v3", Decision: "approve",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.Equal(ProposalRejected, result.Decision)
	s.True(result.OwnerVetoed)
}

func (s *ProposalSuite) TestTally_DeadlinePassed_NoQuorum_Expired() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Expired proposal",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(-1 * time.Hour), // Already expired
	}
	s.store.CreateProposal(ctx, prop)

	// Only 1 vote (not enough for quorum)
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "approve",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.False(result.QuorumReached)
	s.Equal(ProposalExpired, result.Decision)
}

func TestProposalSuite(t *testing.T) {
	suite.Run(t, new(ProposalSuite))
}
