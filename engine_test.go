package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

type EngineSuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *EngineSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *EngineSuite) TearDownTest() {
	s.store.Close()
}

// --- Registration ---

func (s *EngineSuite) TestRegisterNode() {
	node, err := s.engine.RegisterNode(s.ctx, "dev-node", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	s.NotEmpty(node.ID)
	s.Equal("dev-node", node.Name)
	s.Equal(VerticalDev, node.Vertical)
}

func (s *EngineSuite) TestAddItem() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)

	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "Test ADR", "body", "")
	s.Require().NoError(err)
	s.Equal("Test ADR", item.Title)
	s.Equal(StatusUnverified, item.Status)
}

func (s *EngineSuite) TestAddItemInvalidNode() {
	_, err := s.engine.AddItem(s.ctx, "nonexistent", KindADR, "title", "body", "")
	s.Error(err)
	s.Contains(err.Error(), "node not found")
}

// --- Traces ---

func (s *EngineSuite) TestAddTrace() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item1, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-1", "", "")
	s.Require().NoError(err)
	item2, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-2", "", "")
	s.Require().NoError(err)

	trace, err := s.engine.AddTrace(s.ctx, item1.ID, item2.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)
	s.Equal(item1.ID, trace.FromItemID)
	s.Equal(item2.ID, trace.ToItemID)
	s.Equal(node.ID, trace.FromNodeID)
	s.Equal(node.ID, trace.ToNodeID)
}

func (s *EngineSuite) TestAddTraceCrossNode() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	story, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	adr, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	trace, err := s.engine.AddTrace(s.ctx, adr.ID, story.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)
	s.Equal(dev.ID, trace.FromNodeID)
	s.Equal(pm.ID, trace.ToNodeID)
}

func (s *EngineSuite) TestAddTraceInvalidFrom() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, "nonexistent", item.ID, RelationTracedFrom, "dev")
	s.Error(err)
	s.Contains(err.Error(), "from item not found")
}

// --- Verification ---

func (s *EngineSuite) TestVerifyItem() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, item.ID, "test passed", "dev")
	s.Require().NoError(err)

	got, err := s.engine.GetItem(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, got.Status)
	s.Equal("test passed", got.Evidence)
	s.Equal("dev", got.ConfirmedBy)
}

func (s *EngineSuite) TestVerifyAlreadyProven() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, item.ID, "proof", "dev")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, item.ID, "more proof", "dev")
	s.Error(err)
	s.Contains(err.Error(), "already")
}

func (s *EngineSuite) TestMarkBroken() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	// First verify, then make suspect, then break
	err = s.engine.VerifyItem(s.ctx, item.ID, "proof", "dev")
	s.Require().NoError(err)
	err = s.store.UpdateItemStatus(s.ctx, item.ID, StatusSuspect)
	s.Require().NoError(err)

	err = s.engine.MarkBroken(s.ctx, item.ID, "confirmed broken", "dev")
	s.Require().NoError(err)

	got, err := s.engine.GetItem(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(StatusBroke, got.Status)
}

// --- Propagation ---

func (s *EngineSuite) TestPropagationSingleHop() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	upstream, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "Upstream", "", "")
	s.Require().NoError(err)
	downstream, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "Downstream", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, downstream.ID, upstream.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, upstream.ID, "proof", "dev")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, downstream.ID, "proof", "dev")
	s.Require().NoError(err)

	signals, err := s.engine.PropagateChange(s.ctx, upstream.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)

	got, err := s.engine.GetItem(s.ctx, downstream.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, got.Status)
}

func (s *EngineSuite) TestPropagationMultiHop() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	a, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "A", "", "")
	s.Require().NoError(err)
	b, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "B", "", "")
	s.Require().NoError(err)
	c, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "C", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, c.ID, b.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, b.ID, "proof", "dev")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, c.ID, "proof", "dev")
	s.Require().NoError(err)

	signals, err := s.engine.PropagateChange(s.ctx, a.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(signals), 2)

	gotB, err := s.engine.GetItem(s.ctx, b.ID)
	s.Require().NoError(err)
	gotC, err := s.engine.GetItem(s.ctx, c.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, gotB.Status)
	s.Equal(StatusSuspect, gotC.Status)
}

func (s *EngineSuite) TestPropagationSkipsNonProven() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	a, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "A", "", "")
	s.Require().NoError(err)
	b, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "B", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	// Only verify A, leave B as unverified
	err = s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev")
	s.Require().NoError(err)

	signals, err := s.engine.PropagateChange(s.ctx, a.ID)
	s.Require().NoError(err)
	s.Empty(signals, "should not propagate to unverified items")
}

func (s *EngineSuite) TestPropagationCrossNode() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	story, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	adr, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, adr.ID, story.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, story.ID, "approved", "pm")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, adr.ID, "designed", "dev")
	s.Require().NoError(err)

	signals, err := s.engine.PropagateChange(s.ctx, story.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)
	s.Equal(dev.ID, signals[0].TargetNode)

	got, err := s.engine.GetItem(s.ctx, adr.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, got.Status)
}

// --- Impact ---

func (s *EngineSuite) TestComputeImpact() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	a, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "A", "", "")
	s.Require().NoError(err)
	b, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "B", "", "")
	s.Require().NoError(err)
	c, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "C", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, c.ID, a.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	affected, err := s.engine.ComputeImpact(s.ctx, a.ID)
	s.Require().NoError(err)
	s.Len(affected, 2)

	ids := map[string]bool{}
	for _, item := range affected {
		ids[item.ID] = true
	}
	s.True(ids[b.ID])
	s.True(ids[c.ID])
}

func (s *EngineSuite) TestComputeImpactNoDepends() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	a, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "A", "", "")
	s.Require().NoError(err)

	affected, err := s.engine.ComputeImpact(s.ctx, a.ID)
	s.Require().NoError(err)
	s.Empty(affected)
}

// --- Audit ---

func (s *EngineSuite) TestAudit() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "owner", false)
	s.Require().NoError(err)
	item1, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-1", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-2", "", "")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, item1.ID, "proof", "dev")
	s.Require().NoError(err)

	report, err := s.engine.Audit(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Equal(2, report.TotalItems)
	s.Len(report.Proven, 1)
	s.Len(report.Unverified, 1)
	s.Len(report.Orphans, 2) // neither has traces
}

// --- Change Requests ---

func (s *EngineSuite) TestCRFullWorkflow() {
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)

	cr, err := s.engine.CreateCR(s.ctx, "Add WebSocket", "replace polling", "dev", dev.ID, nil)
	s.Require().NoError(err)
	s.Equal(CRDraft, cr.Status)

	s.Require().NoError(s.engine.SubmitCR(s.ctx, cr.ID))
	s.Require().NoError(s.engine.OpenVoting(s.ctx, cr.ID))

	s.Require().NoError(s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm", VoteApprove, "looks good", false))
	s.Require().NoError(s.engine.CastVote(s.ctx, cr.ID, dev.ID, "dev", VoteApprove, "ready", false))

	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))

	got, err := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRApproved, got.Status)
}

func (s *EngineSuite) TestCRRejectWorkflow() {
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)

	cr, err := s.engine.CreateCR(s.ctx, "Risky change", "might break things", "dev", dev.ID, nil)
	s.Require().NoError(err)
	err = s.engine.SubmitCR(s.ctx, cr.ID)
	s.Require().NoError(err)
	err = s.engine.OpenVoting(s.ctx, cr.ID)
	s.Require().NoError(err)

	err = s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm", VoteReject, "too risky", false)
	s.Require().NoError(err)

	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))

	got, err := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRRejected, got.Status)
}

func (s *EngineSuite) TestTallyVotesNoVotes() {
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	cr, err := s.engine.CreateCR(s.ctx, "CR", "desc", "dev", dev.ID, nil)
	s.Require().NoError(err)

	_, err = s.engine.TallyVotes(s.ctx, cr.ID)
	s.Error(err)
	s.Contains(err.Error(), "no votes")
}

// --- Network Queries ---

func (s *EngineSuite) TestAskNetwork() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	q, err := s.engine.AskNetwork(s.ctx, "dev", node.ID, "What uses the API?", "investigating", "")
	s.Require().NoError(err)
	s.NotEmpty(q.ID)
	s.Equal("What uses the API?", q.Question)
}

func (s *EngineSuite) TestRespondToQuery() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	q, err := s.engine.AskNetwork(s.ctx, "dev", node.ID, "question", "", "")
	s.Require().NoError(err)

	resp, err := s.engine.RespondToQuery(s.ctx, q.ID, "pm", node.ID, "answer here", false)
	s.Require().NoError(err)
	s.Equal("answer here", resp.Answer)
}

// --- List ---

func (s *EngineSuite) TestListNodes() {
	_, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	_, err = s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)

	nodes, err := s.engine.ListNodes(s.ctx, "proj")
	s.Require().NoError(err)
	s.Len(nodes, 2)
}

func (s *EngineSuite) TestListItems() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	_, err = s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-1", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(s.ctx, node.ID, KindAPISpec, "API-1", "", "")
	s.Require().NoError(err)

	items, err := s.engine.ListItems(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Len(items, 2)
}

func (s *EngineSuite) TestGetItemTransitions() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, item.ID, "proof", "dev")
	s.Require().NoError(err)

	transitions, err := s.engine.GetItemTransitions(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Len(transitions, 1)
	s.Equal(TransitionVerify, transitions[0].Kind)
}

func TestEngineSuite(t *testing.T) {
	suite.Run(t, new(EngineSuite))
}
