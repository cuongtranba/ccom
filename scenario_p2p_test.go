package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type P2PScenarioSuite struct {
	suite.Suite
}

func (s *P2PScenarioSuite) newTestStack() (*Store, *Engine, *ProposalEngine, *ChallengeEngine) {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.T().Cleanup(func() { store.Close() })

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)
	proposalEng := NewProposalEngine(store)
	challengeEng := NewChallengeEngine(store, proposalEng)

	return store, engine, proposalEng, challengeEng
}

func (s *P2PScenarioSuite) TestScenario_FullGovernanceLifecycle() {
	store, _, proposalEng, _ := s.newTestStack()
	ctx := context.Background()

	// Setup: 3 human nodes + 1 AI node
	for i := 0; i < 3; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("human-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}
	store.CreatePeer(ctx, &Peer{
		PeerID: "ai-0", NodeID: "ai-node", Name: "claude",
		Vertical: VerticalDev, Project: "proj", Owner: "ai",
		IsAI: true, Status: PeerStatusApproved,
	})

	// Create proposal
	prop := &Proposal{
		Kind: ProposalCR, Title: "Switch to WebSocket",
		ProposerPeer: "human-0", ProposerName: "owner-0",
		Deadline: time.Now().Add(24 * time.Hour),
	}
	store.CreateProposal(ctx, prop)

	// All humans approve
	for i := 0; i < 3; i++ {
		store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID, VoterPeer: fmt.Sprintf("human-%d", i),
			VoterID: fmt.Sprintf("v-%d", i), Decision: "approve",
		})
	}

	// AI advises approve (shouldn't count toward quorum)
	store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "ai-0",
		VoterID: "ai-v", Decision: "approve", IsAI: true,
	})

	result, err := proposalEng.ResolveProposal(ctx, prop.ID, "proj")
	s.Require().NoError(err)
	s.Equal(ProposalApproved, result.Decision)
	s.True(result.QuorumReached)
	s.Equal(3, result.HumanVotes)
	s.Equal(1, result.AIVotes)

	// Verify proposal status updated in DB
	got, _ := store.GetProposal(ctx, prop.ID)
	s.Equal(ProposalApproved, got.Status)
}

func (s *P2PScenarioSuite) TestScenario_ChallengeLifecycle() {
	store, _, _, challengeEng := s.newTestStack()
	ctx := context.Background()

	// Setup peers
	for i := 0; i < 3; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("peer-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}

	// peer-0 challenges peer-1
	ch, err := challengeEng.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "No re-verification after upstream change", "", 24*time.Hour)
	s.Require().NoError(err)
	s.Equal(ChallengeOpen, ch.Status)

	// peer-1 responds
	err = challengeEng.RespondToChallenge(ctx, ch.ID, "Re-verified against v2 spec")
	s.Require().NoError(err)

	got, _ := store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeResponded, got.Status)
	s.Equal("Re-verified against v2 spec", got.ResponseEvidence)
}

func (s *P2PScenarioSuite) TestScenario_ChallengeExpiry() {
	store, _, _, challengeEng := s.newTestStack()
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("peer-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}

	// Create already-expired challenge
	ch := &Challenge{
		Kind: ChallengeStaleData, ChallengerPeer: "peer-0",
		ChallengedPeer: "peer-1", TargetItemID: "item-1",
		Reason: "Stale data", Deadline: time.Now().Add(-1 * time.Hour),
	}
	store.CreateChallenge(ctx, ch)

	expired, err := challengeEng.ProcessExpiredChallenges(ctx)
	s.Require().NoError(err)
	s.Len(expired, 1)
	s.Equal(ChallengeExpired, expired[0].Status)

	// Verify reputation
	rep0, _ := store.GetPeerReputation(ctx, "peer-0")
	rep1, _ := store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, rep0)  // Challenger gets +1
	s.Equal(-2, rep1) // Challenged gets -2 for no response
}

func (s *P2PScenarioSuite) TestScenario_SecurityLayer() {
	// Message cache prevents replay
	cache := NewMessageCache(100, 5*time.Minute)
	s.False(cache.IsSeen("msg-1"))
	cache.MarkSeen("msg-1")
	s.True(cache.IsSeen("msg-1"))

	// Rate limiter blocks spam
	limiter := NewPeerRateLimiter(3, time.Minute, 10*time.Second)
	s.True(limiter.AllowMessage("spammer"))
	s.True(limiter.AllowMessage("spammer"))
	s.True(limiter.AllowMessage("spammer"))
	s.False(limiter.AllowMessage("spammer")) // Blocked

	// Different peer still allowed
	s.True(limiter.AllowMessage("good-peer"))
}

func (s *P2PScenarioSuite) TestScenario_OutboxStoreAndForward() {
	store, _, _, _ := s.newTestStack()
	ctx := context.Background()

	sender := NewP2PSender(nil, store)

	// Send to offline peer goes to outbox
	err := sender.SendEnvelope(ctx, "offline-peer", []byte("queued message"))
	s.Require().NoError(err)

	// Verify in outbox
	msgs, err := store.GetPendingOutbox(ctx, "offline-peer", 10)
	s.Require().NoError(err)
	s.Len(msgs, 1)
	s.Equal("queued message", string(msgs[0].Envelope))

	// Increment attempts (backoff)
	store.IncrementOutboxAttempts(ctx, msgs[0].ID)
}

func (s *P2PScenarioSuite) TestScenario_IdentityPersistence() {
	tmpDir := s.T().TempDir()
	keyPath := tmpDir + "/identity.key"
	peerIDPath := tmpDir + "/peer_id"

	// Generate
	ident1, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	// Reload
	ident2, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	// Same identity
	s.Equal(ident1.PeerID, ident2.PeerID)
}

func (s *P2PScenarioSuite) TestScenario_ObservabilityAlerts() {
	store, _, _, _ := s.newTestStack()
	ctx := context.Background()

	cfg := DefaultNodeConfig()
	cfg.Observability.AlertOutboxThreshold = 2

	// Add enough outbox messages to trigger alert
	for i := 0; i < 3; i++ {
		store.EnqueueOutbox(ctx, &OutboxMessage{
			ToPeer:   "peer-1",
			Envelope: []byte(fmt.Sprintf("msg-%d", i)),
		})
	}

	alerts, err := CheckAlerts(ctx, store, cfg, "self-peer", "proj")
	s.Require().NoError(err)

	found := false
	for _, a := range alerts {
		if a.Kind == AlertOutboxBacklog {
			found = true
			s.Equal("warn", a.Level)
		}
	}
	s.True(found, "expected outbox backlog alert")
}

func TestP2PScenarioSuite(t *testing.T) {
	suite.Run(t, new(P2PScenarioSuite))
}
