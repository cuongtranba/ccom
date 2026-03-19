package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type ChallengeSuite struct {
	suite.Suite
	store     *Store
	engine    *ChallengeEngine
	proposals *ProposalEngine
}

func (s *ChallengeSuite) SetupTest() {
	tmpDir := s.T().TempDir()
	var err error
	s.store, err = NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.proposals = NewProposalEngine(s.store)
	s.engine = NewChallengeEngine(s.store, s.proposals)
}

func (s *ChallengeSuite) TearDownTest() {
	s.store.Close()
}

func (s *ChallengeSuite) seedApprovedPeers(count int) {
	ctx := context.Background()
	for i := 0; i < count; i++ {
		s.store.CreatePeer(ctx, &Peer{
			PeerID:   fmt.Sprintf("peer-%d", i),
			NodeID:   fmt.Sprintf("node-%d", i),
			Name:     fmt.Sprintf("name-%d", i),
			Vertical: VerticalDev,
			Project:  "proj",
			Owner:    fmt.Sprintf("owner-%d", i),
			Status:   PeerStatusApproved,
		})
	}
}

func (s *ChallengeSuite) TestCreateChallenge_Success() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	ch, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale data", "evidence", 24*time.Hour)
	s.Require().NoError(err)
	s.NotEmpty(ch.ID)
	s.Equal(ChallengeOpen, ch.Status)
	s.Equal(ChallengeStaleData, ch.Kind)
}

func (s *ChallengeSuite) TestCreateChallenge_SelfChallenge_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-0", "item-1", "", "Stale data", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "self-challenge")
}

func (s *ChallengeSuite) TestCreateChallenge_Cooldown_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// First challenge succeeds
	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "First", "", 24*time.Hour)
	s.Require().NoError(err)

	// Second challenge within cooldown fails
	_, err = s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-2", "", "Second", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "cooldown")
}

func (s *ChallengeSuite) TestCreateChallenge_ReputationFloor_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// Set reputation to floor
	for i := 0; i < 12; i++ {
		s.store.AdjustPeerReputation(ctx, "peer-0", -1)
	}

	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Should fail", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "reputation")
}

func (s *ChallengeSuite) TestRespondToChallenge_Success() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	ch, _ := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale", "", 24*time.Hour)

	err := s.engine.RespondToChallenge(ctx, ch.ID, "Re-verified against latest spec")
	s.Require().NoError(err)

	got, _ := s.store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeResponded, got.Status)
	s.Equal("Re-verified against latest spec", got.ResponseEvidence)
}

func (s *ChallengeSuite) TestResolveChallenge_Sustained() {
	ctx := context.Background()
	s.seedApprovedPeers(4)

	ch, _ := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale", "", 24*time.Hour)

	s.engine.RespondToChallenge(ctx, ch.ID, "My evidence")

	// Create challenge proposal votes (sustain majority)
	prop, _ := s.store.ListProposals(ctx, ProposalVoting)
	if len(prop) > 0 {
		// Vote to sustain
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop[0].ID, VoterPeer: "peer-2", VoterID: "v2", Decision: "approve",
		})
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop[0].ID, VoterPeer: "peer-3", VoterID: "v3", Decision: "approve",
		})
	}

	result, err := s.engine.ResolveChallenge(ctx, ch.ID, "proj")
	s.Require().NoError(err)
	s.Equal(ChallengeSustained, result.Status)

	// Check reputation adjustments
	challengerRep, _ := s.store.GetPeerReputation(ctx, "peer-0")
	challengedRep, _ := s.store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, challengerRep)
	s.Equal(-1, challengedRep)
}

func (s *ChallengeSuite) TestAutoExpire_AppliesPenalty() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// Create challenge with already-expired deadline
	ch := &Challenge{
		Kind:           ChallengeStaleData,
		ChallengerPeer: "peer-0",
		ChallengedPeer: "peer-1",
		TargetItemID:   "item-1",
		Reason:         "Expired challenge",
		Deadline:       time.Now().Add(-1 * time.Hour),
	}
	s.store.CreateChallenge(ctx, ch)

	expired, err := s.engine.ProcessExpiredChallenges(ctx)
	s.Require().NoError(err)
	s.Len(expired, 1)

	got, _ := s.store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeExpired, got.Status)

	// Reputation: challenger +1, challenged -2
	challengerRep, _ := s.store.GetPeerReputation(ctx, "peer-0")
	challengedRep, _ := s.store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, challengerRep)
	s.Equal(-2, challengedRep)
}

func TestChallengeSuite(t *testing.T) {
	suite.Run(t, new(ChallengeSuite))
}
