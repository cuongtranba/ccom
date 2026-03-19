package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

type FullFlowSuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *FullFlowSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *FullFlowSuite) TearDownTest() {
	s.store.Close()
}

func TestFullFlowSuite(t *testing.T) {
	suite.Run(t, new(FullFlowSuite))
}

// registerNode is a helper that registers a node and fails the test on error.
func (s *FullFlowSuite) registerNode(name string, vertical Vertical, owner string) *Node {
	node, err := s.engine.RegisterNode(s.ctx, name, vertical, "clinic-checkin", owner, false)
	s.Require().NoError(err)
	return node
}

// registerAINode registers an AI-managed node.
func (s *FullFlowSuite) registerAINode(name string, vertical Vertical, owner string) *Node {
	node, err := s.engine.RegisterNode(s.ctx, name, vertical, "clinic-checkin", owner, true)
	s.Require().NoError(err)
	return node
}

// addItem is a helper that creates an item and fails the test on error.
func (s *FullFlowSuite) addItem(nodeID string, kind ItemKind, title string) *Item {
	item, err := s.engine.AddItem(s.ctx, nodeID, kind, title, "", "")
	s.Require().NoError(err)
	return item
}

// TestFullItemLifecycle walks an item through every state transition.
//
// Path: unverified -> proven -> suspect -> proven (re_verify) -> suspect -> broke -> proven (fix)
// Verifies: final status, transition count, transition ordering.
func (s *FullFlowSuite) TestFullItemLifecycle() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")
	upstream := s.addItem(node.ID, KindADR, "Upstream")
	target := s.addItem(node.ID, KindADR, "Target")
	s.engine.AddTrace(s.ctx, target.ID, upstream.ID, RelationTracedFrom, "dev-lead")

	// 1. unverified -> proven
	s.Require().NoError(s.engine.VerifyItem(s.ctx, target.ID, "design reviewed", "dev-lead"))
	got, _ := s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusProven, got.Status)

	// 2. proven -> suspect (via propagation from upstream)
	s.engine.VerifyItem(s.ctx, upstream.ID, "approved", "dev-lead")
	signals, err := s.engine.PropagateChange(s.ctx, upstream.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)
	got, _ = s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusSuspect, got.Status)

	// 3. suspect -> proven (re_verify)
	s.Require().NoError(s.engine.VerifyItem(s.ctx, target.ID, "still valid", "dev-lead"))
	got, _ = s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusProven, got.Status)

	// 4. proven -> suspect (second propagation)
	signals, err = s.engine.PropagateChange(s.ctx, upstream.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)
	got, _ = s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusSuspect, got.Status)

	// 5. suspect -> broke
	s.Require().NoError(s.engine.MarkBroken(s.ctx, target.ID, "API endpoint removed", "dev-lead"))
	got, _ = s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusBroke, got.Status)

	// 6. broke -> proven (fix)
	s.Require().NoError(s.engine.VerifyItem(s.ctx, target.ID, "rebuilt with new endpoint", "dev-lead"))
	got, _ = s.engine.GetItem(s.ctx, target.ID)
	s.Equal(StatusProven, got.Status)

	// Verify complete transition history
	transitions, err := s.engine.GetItemTransitions(s.ctx, target.ID)
	s.Require().NoError(err)
	s.Len(transitions, 6, "should have 6 transitions: verify, suspect, re_verify, suspect, break, fix")

	expected := []TransitionKind{
		TransitionVerify,   // unverified -> proven
		TransitionSuspect,  // proven -> suspect
		TransitionReVerify, // suspect -> proven
		TransitionSuspect,  // proven -> suspect
		TransitionBreak,    // suspect -> broke
		TransitionFix,      // broke -> proven
	}
	for i, t := range transitions {
		s.Equal(expected[i], t.Kind, "transition %d should be %s", i, expected[i])
	}
}

// TestFiveVerticalPropagation creates a realistic five-vertical trace chain and
// verifies that a change at the PM level cascades through Design -> Dev -> QA -> DevOps.
func (s *FullFlowSuite) TestFiveVerticalPropagation() {
	pm := s.registerNode("pm", VerticalPM, "pm-lead")
	design := s.registerNode("design", VerticalDesign, "designer")
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	qa := s.registerNode("qa", VerticalQA, "qa-lead")
	devops := s.registerNode("devops", VerticalDevOps, "devops-lead")

	userStory := s.addItem(pm.ID, KindUserStory, "US-003 Kiosk Check-in")
	screenSpec := s.addItem(design.ID, KindScreenSpec, "Check-in Screen")
	adr := s.addItem(dev.ID, KindADR, "WebSocket ADR")
	testPlan := s.addItem(qa.ID, KindTestPlan, "E2E Test Plan")
	runbook := s.addItem(devops.ID, KindRunbook, "Deploy Runbook")

	// Trace chain: Design <- PM, Dev <- Design, QA <- Dev, DevOps <- QA
	s.engine.AddTrace(s.ctx, screenSpec.ID, userStory.ID, RelationTracedFrom, "designer")
	s.engine.AddTrace(s.ctx, adr.ID, screenSpec.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, testPlan.ID, adr.ID, RelationTracedFrom, "qa-lead")
	s.engine.AddTrace(s.ctx, runbook.ID, testPlan.ID, RelationTracedFrom, "devops-lead")

	// Verify all items
	s.engine.VerifyItem(s.ctx, userStory.ID, "Product approved", "pm-lead")
	s.engine.VerifyItem(s.ctx, screenSpec.ID, "Design review", "designer")
	s.engine.VerifyItem(s.ctx, adr.ID, "Arch review", "dev-lead")
	s.engine.VerifyItem(s.ctx, testPlan.ID, "QA approved", "qa-lead")
	s.engine.VerifyItem(s.ctx, runbook.ID, "Ops review", "devops-lead")

	// PM changes user story — should cascade through ALL 4 downstream verticals
	signals, err := s.engine.PropagateChange(s.ctx, userStory.ID)
	s.Require().NoError(err)
	s.Len(signals, 4, "change should cascade through design, dev, qa, devops")

	// All downstream items should be suspect
	for _, id := range []string{screenSpec.ID, adr.ID, testPlan.ID, runbook.ID} {
		item, _ := s.engine.GetItem(s.ctx, id)
		s.Equal(StatusSuspect, item.Status, "item %s should be suspect", item.Title)
	}

	// User story itself stays proven (source of change, not a dependent)
	got, _ := s.engine.GetItem(s.ctx, userStory.ID)
	s.Equal(StatusProven, got.Status)

	// Audit each node — all should have 1 suspect item except PM (1 proven)
	pmReport, _ := s.engine.Audit(s.ctx, pm.ID)
	s.Equal(1, len(pmReport.Proven))
	s.Equal(0, len(pmReport.Suspect))

	devReport, _ := s.engine.Audit(s.ctx, dev.ID)
	s.Equal(0, len(devReport.Proven))
	s.Equal(1, len(devReport.Suspect))
}

// TestDiamondGraphPropagation creates A -> B -> D and A -> C -> D.
// Verifies D is marked suspect once (not twice) and total signal count is correct.
func (s *FullFlowSuite) TestDiamondGraphPropagation() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")

	a := s.addItem(node.ID, KindADR, "Root A")
	b := s.addItem(node.ID, KindADR, "Branch B")
	c := s.addItem(node.ID, KindADR, "Branch C")
	d := s.addItem(node.ID, KindADR, "Leaf D")

	// Diamond: B <- A, C <- A, D <- B, D <- C
	s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, c.ID, a.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, d.ID, b.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, d.ID, c.ID, RelationTracedFrom, "dev-lead")

	// Verify all
	s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, b.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, c.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, d.ID, "proof", "dev-lead")

	// Propagate from A
	signals, err := s.engine.PropagateChange(s.ctx, a.ID)
	s.Require().NoError(err)

	// B and C get direct signals. D gets signal from B's propagation.
	// When C propagates, D is already suspect so it's skipped.
	// Total: B + D (from B path) + C = 3 signals
	s.Equal(3, len(signals), "B, C, and D should each get one signal")

	// All should be suspect
	for _, id := range []string{b.ID, c.ID, d.ID} {
		item, _ := s.engine.GetItem(s.ctx, id)
		s.Equal(StatusSuspect, item.Status)
	}

	// D should have exactly 1 suspect transition (not 2)
	transitions, _ := s.engine.GetItemTransitions(s.ctx, d.ID)
	suspectCount := 0
	for _, t := range transitions {
		if t.Kind == TransitionSuspect {
			suspectCount++
		}
	}
	s.Equal(1, suspectCount, "D should be marked suspect only once")
}

// TestCycleDetectionInPropagation creates a circular trace graph (A -> B -> C -> A)
// and verifies that PropagateChange terminates without infinite recursion.
func (s *FullFlowSuite) TestCycleDetectionInPropagation() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")

	a := s.addItem(node.ID, KindADR, "A")
	b := s.addItem(node.ID, KindADR, "B")
	c := s.addItem(node.ID, KindADR, "C")

	// Circular: B <- A, C <- B, A <- C
	s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, c.ID, b.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, a.ID, c.ID, RelationTracedFrom, "dev-lead")

	// Verify all
	s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, b.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, c.ID, "proof", "dev-lead")

	// This should NOT hang — cycle detection must terminate
	signals, err := s.engine.PropagateChange(s.ctx, a.ID)
	s.Require().NoError(err)

	// B and C should get signals
	s.GreaterOrEqual(len(signals), 2, "B and C should get signals")

	for _, id := range []string{b.ID, c.ID} {
		item, _ := s.engine.GetItem(s.ctx, id)
		s.Equal(StatusSuspect, item.Status)
	}
}

// TestCompleteCRLifecycleApproval walks a CR through all states to archived (happy path).
func (s *FullFlowSuite) TestCompleteCRLifecycleApproval() {
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	pm := s.registerNode("pm", VerticalPM, "pm-lead")
	qa := s.registerNode("qa", VerticalQA, "qa-lead")

	item := s.addItem(dev.ID, KindADR, "WebSocket ADR")

	// 1. Draft
	cr, err := s.engine.CreateCR(s.ctx, "Switch to WebSocket", "Replace polling", "dev-lead", dev.ID, []string{item.ID})
	s.Require().NoError(err)
	s.Equal(CRDraft, cr.Status)

	// 2. Proposed
	s.Require().NoError(s.engine.SubmitCR(s.ctx, cr.ID))
	got, _ := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRProposed, got.Status)

	// 3. Voting
	s.Require().NoError(s.engine.OpenVoting(s.ctx, cr.ID))
	got, _ = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRVoting, got.Status)

	// Cast votes
	s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm-lead", VoteApprove, "good idea", false)
	s.engine.CastVote(s.ctx, cr.ID, qa.ID, "qa-lead", VoteApprove, "test plan ok", false)

	// 4. Approved (via resolve)
	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))
	got, _ = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRApproved, got.Status)

	// 5. Applied
	newStatus, err := s.engine.crSM.Apply(got.Status, CRApplyT)
	s.Require().NoError(err)
	s.Require().NoError(s.store.UpdateCRStatus(s.ctx, cr.ID, newStatus))
	got, _ = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRApplied, got.Status)

	// 6. Archived
	newStatus, err = s.engine.crSM.Apply(got.Status, CRArchive)
	s.Require().NoError(err)
	s.Require().NoError(s.store.UpdateCRStatus(s.ctx, cr.ID, newStatus))
	got, _ = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRArchived, got.Status)
}

// TestCompleteCRLifecycleRejection walks a CR through rejection to archived.
func (s *FullFlowSuite) TestCompleteCRLifecycleRejection() {
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	pm := s.registerNode("pm", VerticalPM, "pm-lead")

	cr, _ := s.engine.CreateCR(s.ctx, "Risky change", "Big refactor", "dev-lead", dev.ID, nil)
	s.engine.SubmitCR(s.ctx, cr.ID)
	s.engine.OpenVoting(s.ctx, cr.ID)

	// PM rejects
	s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm-lead", VoteReject, "too risky", false)

	// Resolve -> rejected
	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))
	got, _ := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRRejected, got.Status)

	// Archive
	newStatus, err := s.engine.crSM.Apply(got.Status, CRArchive)
	s.Require().NoError(err)
	s.Require().NoError(s.store.UpdateCRStatus(s.ctx, cr.ID, newStatus))
	got, _ = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Equal(CRArchived, got.Status)
}

// TestAIVotesAdvisoryOnly verifies that AI votes don't count toward CR tally.
// 2 AI approves + 1 human reject = REJECTED (human votes are the only ones that count).
func (s *FullFlowSuite) TestAIVotesAdvisoryOnly() {
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	pm := s.registerNode("pm", VerticalPM, "pm-lead")
	aiDev := s.registerAINode("ai-dev", VerticalDev, "claude")
	aiQA := s.registerAINode("ai-qa", VerticalQA, "ai-qa-bot")

	cr, _ := s.engine.CreateCR(s.ctx, "AI-recommended change", "Refactor", "dev-lead", dev.ID, nil)
	s.engine.SubmitCR(s.ctx, cr.ID)
	s.engine.OpenVoting(s.ctx, cr.ID)

	// 2 AI votes approve
	s.engine.CastVote(s.ctx, cr.ID, aiDev.ID, "claude", VoteApprove, "looks good", true)
	s.engine.CastVote(s.ctx, cr.ID, aiQA.ID, "ai-qa-bot", VoteApprove, "tests pass", true)

	// 1 human vote rejects
	s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm-lead", VoteReject, "too risky", false)

	// Tally should only count human votes: 1 reject = REJECT
	decision, err := s.engine.TallyVotes(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(VoteReject, decision, "AI votes should be advisory-only; 1 human reject = rejected")
}

// TestAIOnlyVotesNoQuorum verifies that a CR with ONLY AI votes has no human quorum.
func (s *FullFlowSuite) TestAIOnlyVotesNoQuorum() {
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	aiDev := s.registerAINode("ai-dev", VerticalDev, "claude")

	cr, _ := s.engine.CreateCR(s.ctx, "AI-only vote", "Refactor", "dev-lead", dev.ID, nil)
	s.engine.SubmitCR(s.ctx, cr.ID)
	s.engine.OpenVoting(s.ctx, cr.ID)

	// Only AI votes
	s.engine.CastVote(s.ctx, cr.ID, aiDev.ID, "claude", VoteApprove, "looks good", true)

	// Tally with only AI votes should return error (no human votes)
	_, err := s.engine.TallyVotes(s.ctx, cr.ID)
	s.Error(err, "should error when no human votes exist")
}

// TestParallelCRsIndependent verifies that two concurrent CRs don't interfere.
func (s *FullFlowSuite) TestParallelCRsIndependent() {
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	pm := s.registerNode("pm", VerticalPM, "pm-lead")
	qa := s.registerNode("qa", VerticalQA, "qa-lead")

	// Create two CRs
	cr1, _ := s.engine.CreateCR(s.ctx, "CR-1 WebSocket", "Switch transport", "dev-lead", dev.ID, nil)
	cr2, _ := s.engine.CreateCR(s.ctx, "CR-2 New DB", "Switch to Postgres", "dev-lead", dev.ID, nil)

	// Both go through voting
	s.engine.SubmitCR(s.ctx, cr1.ID)
	s.engine.OpenVoting(s.ctx, cr1.ID)
	s.engine.SubmitCR(s.ctx, cr2.ID)
	s.engine.OpenVoting(s.ctx, cr2.ID)

	// CR1: approved (PM + QA approve)
	s.engine.CastVote(s.ctx, cr1.ID, pm.ID, "pm-lead", VoteApprove, "ok", false)
	s.engine.CastVote(s.ctx, cr1.ID, qa.ID, "qa-lead", VoteApprove, "ok", false)

	// CR2: rejected (PM approves, QA rejects)
	s.engine.CastVote(s.ctx, cr2.ID, pm.ID, "pm-lead", VoteApprove, "ok", false)
	s.engine.CastVote(s.ctx, cr2.ID, qa.ID, "qa-lead", VoteReject, "need more testing", false)

	// Resolve both
	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr1.ID))
	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr2.ID))

	got1, _ := s.store.GetChangeRequest(s.ctx, cr1.ID)
	got2, _ := s.store.GetChangeRequest(s.ctx, cr2.ID)

	s.Equal(CRApproved, got1.Status, "CR1 should be approved")
	s.Equal(CRRejected, got2.Status, "CR2 should be rejected")

	// Votes don't leak between CRs
	votes1, _ := s.store.GetVotesForCR(s.ctx, cr1.ID)
	votes2, _ := s.store.GetVotesForCR(s.ctx, cr2.ID)
	s.Len(votes1, 2)
	s.Len(votes2, 2)
}

// TestNetworkQueryRoundTrip tests the full query -> response -> follow-up cycle.
func (s *FullFlowSuite) TestNetworkQueryRoundTrip() {
	pm := s.registerNode("pm", VerticalPM, "pm-lead")
	dev := s.registerNode("dev", VerticalDev, "dev-lead")
	qa := s.registerNode("qa", VerticalQA, "qa-lead")

	// QA asks Dev: "What implements US-003?"
	q1, err := s.engine.AskNetwork(s.ctx, "qa-lead", qa.ID, "What implements US-003?", "sprint planning", dev.ID)
	s.Require().NoError(err)
	s.Equal(dev.ID, q1.TargetNode)
	s.False(q1.Resolved)

	// Dev responds (human)
	resp1, err := s.engine.RespondToQuery(s.ctx, q1.ID, "dev-lead", dev.ID, "auth-handler implements US-003", false)
	s.Require().NoError(err)
	s.False(resp1.IsAI)

	// QA follows up by asking PM
	q2, err := s.engine.AskNetwork(s.ctx, "qa-lead", qa.ID, "Is US-003 prioritized for this sprint?", "sprint planning", pm.ID)
	s.Require().NoError(err)
	s.Equal(pm.ID, q2.TargetNode)

	// PM's AI assistant responds
	resp2, err := s.engine.RespondToQuery(s.ctx, q2.ID, "claude", pm.ID, "Yes, US-003 is high priority", true)
	s.Require().NoError(err)
	s.True(resp2.IsAI, "AI responses should be flagged")

	// Both queries and responses exist
	s.NotEqual(q1.ID, q2.ID, "queries should have unique IDs")
	s.NotEqual(resp1.ID, resp2.ID, "responses should have unique IDs")
}

// TestAuditReportComprehensive creates items in all states and verifies audit accuracy.
func (s *FullFlowSuite) TestAuditReportComprehensive() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")

	// Create items that will end up in various states
	unverified := s.addItem(node.ID, KindADR, "Draft ADR")     // stays unverified
	proven := s.addItem(node.ID, KindAPISpec, "Stable API")     // will be verified
	suspect := s.addItem(node.ID, KindADR, "Suspect ADR")       // will be marked suspect
	broke := s.addItem(node.ID, KindDataModel, "Broken Model")  // will be marked broken
	orphan := s.addItem(node.ID, KindADR, "Orphan ADR")         // no traces, verified

	// Set up traces (except orphan — it has none)
	s.engine.AddTrace(s.ctx, suspect.ID, proven.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, broke.ID, proven.ID, RelationTracedFrom, "dev-lead")

	// Verify items that need it
	s.engine.VerifyItem(s.ctx, proven.ID, "reviewed", "dev-lead")
	s.engine.VerifyItem(s.ctx, suspect.ID, "reviewed", "dev-lead")
	s.engine.VerifyItem(s.ctx, broke.ID, "reviewed", "dev-lead")
	s.engine.VerifyItem(s.ctx, orphan.ID, "reviewed", "dev-lead")

	// Propagate change from proven -> suspect and broke become suspect
	s.engine.PropagateChange(s.ctx, proven.ID)

	// Mark one as broken
	s.engine.MarkBroken(s.ctx, broke.ID, "data model obsolete", "dev-lead")

	// Run audit
	report, err := s.engine.Audit(s.ctx, node.ID)
	s.Require().NoError(err)

	s.Equal(5, report.TotalItems)
	s.Len(report.Unverified, 1, "1 unverified item (Draft ADR)")
	s.Len(report.Proven, 2, "2 proven items (Stable API + Orphan ADR)")
	s.Len(report.Suspect, 1, "1 suspect item (Suspect ADR)")
	s.Len(report.Broke, 1, "1 broke item (Broken Model)")

	// Orphan detection: unverified has no traces, orphan has no traces
	s.Len(report.Orphans, 2, "2 orphans (Draft ADR + Orphan ADR have no traces)")
	s.Contains(report.Orphans, unverified.ID)
	s.Contains(report.Orphans, orphan.ID)
}

// TestErrorBoundaries verifies that all invalid operations produce clear errors.
func (s *FullFlowSuite) TestErrorBoundaries() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")

	// Verify already-proven item
	item := s.addItem(node.ID, KindADR, "ADR")
	s.engine.VerifyItem(s.ctx, item.ID, "proof", "dev-lead")
	err := s.engine.VerifyItem(s.ctx, item.ID, "re-proof", "dev-lead")
	s.Error(err, "cannot verify an already-proven item")

	// Break an unverified item
	unverified := s.addItem(node.ID, KindADR, "Unverified")
	err = s.engine.MarkBroken(s.ctx, unverified.ID, "reason", "dev-lead")
	s.Error(err, "cannot break an unverified item")

	// Add item to non-existent node
	_, err = s.engine.AddItem(s.ctx, "non-existent-node-id", KindADR, "title", "body", "")
	s.Error(err, "should fail for non-existent node")

	// Trace to non-existent item
	_, err = s.engine.AddTrace(s.ctx, item.ID, "non-existent-item-id", RelationTracedFrom, "dev-lead")
	s.Error(err, "should fail for non-existent target item")

	_, err = s.engine.AddTrace(s.ctx, "non-existent-item-id", item.ID, RelationTracedFrom, "dev-lead")
	s.Error(err, "should fail for non-existent source item")

	// Tally CR with no votes
	cr, _ := s.engine.CreateCR(s.ctx, "Test", "desc", "dev-lead", node.ID, nil)
	s.engine.SubmitCR(s.ctx, cr.ID)
	s.engine.OpenVoting(s.ctx, cr.ID)
	_, err = s.engine.TallyVotes(s.ctx, cr.ID)
	s.Error(err, "should fail with no votes")

	// Invalid CR state transition: try to open voting before submitting
	cr2, _ := s.engine.CreateCR(s.ctx, "Test2", "desc", "dev-lead", node.ID, nil)
	err = s.engine.OpenVoting(s.ctx, cr2.ID)
	s.Error(err, "cannot open voting on a draft CR")

	// Submit same CR twice
	s.engine.SubmitCR(s.ctx, cr2.ID)
	err = s.engine.SubmitCR(s.ctx, cr2.ID)
	s.Error(err, "cannot submit an already-proposed CR")

	// Propagate from item with no dependents
	standalone := s.addItem(node.ID, KindADR, "Standalone")
	signals, err := s.engine.PropagateChange(s.ctx, standalone.ID)
	s.NoError(err, "propagate with no dependents should not error")
	s.Empty(signals, "no dependents = no signals")

	// Impact on item with no dependents
	affected, err := s.engine.ComputeImpact(s.ctx, standalone.ID)
	s.NoError(err)
	s.Empty(affected)
}

// TestDetectSuspectItems verifies that DetectSuspect finds all suspect items in a node.
func (s *FullFlowSuite) TestDetectSuspectItems() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")

	// Create chain: root -> a -> b -> c
	root := s.addItem(node.ID, KindADR, "Root")
	a := s.addItem(node.ID, KindADR, "Item A")
	b := s.addItem(node.ID, KindADR, "Item B")
	c := s.addItem(node.ID, KindADR, "Item C")

	s.engine.AddTrace(s.ctx, a.ID, root.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev-lead")
	s.engine.AddTrace(s.ctx, c.ID, b.ID, RelationTracedFrom, "dev-lead")

	// Before propagation: no suspect items
	sm := NewStateMachine()
	prop := NewSignalPropagator(s.store, sm)
	suspects, err := prop.DetectSuspect(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Empty(suspects, "no suspect items before propagation")

	// Verify all, then propagate from root
	s.engine.VerifyItem(s.ctx, root.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, b.ID, "proof", "dev-lead")
	s.engine.VerifyItem(s.ctx, c.ID, "proof", "dev-lead")
	s.engine.PropagateChange(s.ctx, root.ID)

	// After propagation: 3 suspect items
	suspects, err = prop.DetectSuspect(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Len(suspects, 3, "a, b, c should all be suspect")

	// Re-verify one
	s.engine.VerifyItem(s.ctx, a.ID, "re-checked", "dev-lead")
	suspects, err = prop.DetectSuspect(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Len(suspects, 2, "b and c still suspect")
}

// TestResultJSONAcceptsTypedValues verifies that resultJSON works with all domain types.
func (s *FullFlowSuite) TestResultJSONAcceptsTypedValues() {
	node := s.registerNode("dev", VerticalDev, "dev-lead")
	item := s.addItem(node.ID, KindADR, "Test ADR")

	// Verify all our domain types serialize correctly
	nodeResult, err := resultJSON(node)
	s.Require().NoError(err)
	s.NotNil(nodeResult)

	itemResult, err := resultJSON(item)
	s.Require().NoError(err)
	s.NotNil(itemResult)

	// Slice of items
	items, _ := s.engine.ListItems(s.ctx, node.ID)
	itemsResult, err := resultJSON(items)
	s.Require().NoError(err)
	s.NotNil(itemsResult)

	// Audit report
	report, _ := s.engine.Audit(s.ctx, node.ID)
	reportResult, err := resultJSON(report)
	s.Require().NoError(err)
	s.NotNil(reportResult)
}
