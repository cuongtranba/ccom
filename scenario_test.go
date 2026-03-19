package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

type ScenarioSuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *ScenarioSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *ScenarioSuite) TearDownTest() {
	s.store.Close()
}

func (s *ScenarioSuite) TestPMChangesSpec() {
	// Setup: PM and Dev nodes
	pm, err := s.engine.RegisterNode(s.ctx, "pm-node", VerticalPM, "clinic-checkin", "pm-lead", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev-node", VerticalDev, "clinic-checkin", "dev-lead", false)
	s.Require().NoError(err)

	// PM adds user story
	us, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "Check-in flow redesign", "User can check in via kiosk", "")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, us.ID, "Product approved", "pm-lead")
	s.Require().NoError(err)

	// Dev traces ADR and API spec from the user story
	adr, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "WebSocket for real-time", "", "")
	s.Require().NoError(err)
	api, err := s.engine.AddItem(s.ctx, dev.ID, KindAPISpec, "Check-in API v2", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, adr.ID, us.ID, RelationTracedFrom, "dev-lead")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, api.ID, us.ID, RelationTracedFrom, "dev-lead")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, adr.ID, "Design reviewed", "dev-lead")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, api.ID, "Spec reviewed", "dev-lead")
	s.Require().NoError(err)

	// PM changes the user story — propagate change
	signals, err := s.engine.PropagateChange(s.ctx, us.ID)
	s.Require().NoError(err)
	s.Len(signals, 2, "both ADR and API should be marked suspect")

	// Dev's items should now be suspect
	gotADR, err := s.engine.GetItem(s.ctx, adr.ID)
	s.Require().NoError(err)
	gotAPI, err := s.engine.GetItem(s.ctx, api.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, gotADR.Status)
	s.Equal(StatusSuspect, gotAPI.Status)

	// Dev re-verifies the ADR, marks API as broke
	err = s.engine.VerifyItem(s.ctx, adr.ID, "Still valid after spec change", "dev-lead")
	s.Require().NoError(err)
	err = s.engine.MarkBroken(s.ctx, api.ID, "API needs v3 endpoint", "dev-lead")
	s.Require().NoError(err)

	// Verify final states
	gotADR, err = s.engine.GetItem(s.ctx, adr.ID)
	s.Require().NoError(err)
	gotAPI, err = s.engine.GetItem(s.ctx, api.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, gotADR.Status)
	s.Equal(StatusBroke, gotAPI.Status)
}

func (s *ScenarioSuite) TestCrossTeamCR() {
	dev, err := s.engine.RegisterNode(s.ctx, "dev-node", VerticalDev, "clinic-checkin", "dev-lead", false)
	s.Require().NoError(err)
	pm, err := s.engine.RegisterNode(s.ctx, "pm-node", VerticalPM, "clinic-checkin", "pm-lead", false)
	s.Require().NoError(err)
	qa, err := s.engine.RegisterNode(s.ctx, "qa-node", VerticalQA, "clinic-checkin", "qa-lead", false)
	s.Require().NoError(err)

	// Dev creates a CR
	cr, err := s.engine.CreateCR(s.ctx, "Switch to WebSocket", "Replace polling with WebSocket", "dev-lead", dev.ID, nil)
	s.Require().NoError(err)
	s.Equal(CRDraft, cr.Status)

	// Submit → open voting
	s.Require().NoError(s.engine.SubmitCR(s.ctx, cr.ID))
	s.Require().NoError(s.engine.OpenVoting(s.ctx, cr.ID))

	// PM and QA vote approve
	s.Require().NoError(s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm-lead", VoteApprove, "Aligns with product goals", false))
	s.Require().NoError(s.engine.CastVote(s.ctx, cr.ID, qa.ID, "qa-lead", VoteApprove, "Test plan looks solid", false))

	// Resolve — should be approved
	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))

	got, err := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRApproved, got.Status)
}

func (s *ScenarioSuite) TestCrossTeamCRRejected() {
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	qa, err := s.engine.RegisterNode(s.ctx, "qa", VerticalQA, "proj", "qa", false)
	s.Require().NoError(err)

	cr, err := s.engine.CreateCR(s.ctx, "Risky refactor", "Big change", "dev", dev.ID, nil)
	s.Require().NoError(err)
	err = s.engine.SubmitCR(s.ctx, cr.ID)
	s.Require().NoError(err)
	err = s.engine.OpenVoting(s.ctx, cr.ID)
	s.Require().NoError(err)

	// PM approves but QA rejects
	err = s.engine.CastVote(s.ctx, cr.ID, pm.ID, "pm", VoteApprove, "ok", false)
	s.Require().NoError(err)
	err = s.engine.CastVote(s.ctx, cr.ID, qa.ID, "qa", VoteReject, "needs more testing", false)
	s.Require().NoError(err)

	s.Require().NoError(s.engine.ResolveCR(s.ctx, cr.ID))

	got, err := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRRejected, got.Status, "one reject should reject the CR")
}

func (s *ScenarioSuite) TestDeepPropagationAcrossThreeNodes() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	design, err := s.engine.RegisterNode(s.ctx, "design", VerticalDesign, "proj", "designer", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	// PM: business requirement
	bizReq, err := s.engine.AddItem(s.ctx, pm.ID, KindEpic, "Kiosk check-in", "", "")
	s.Require().NoError(err)

	// Design: screen spec traces from biz req
	screen, err := s.engine.AddItem(s.ctx, design.ID, KindScreenSpec, "Check-in screen", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, screen.ID, bizReq.ID, RelationTracedFrom, "designer")
	s.Require().NoError(err)

	// Dev: data model traces from screen spec
	model, err := s.engine.AddItem(s.ctx, dev.ID, KindDataModel, "CheckIn table", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, model.ID, screen.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	// Dev: test case traces from data model
	test, err := s.engine.AddItem(s.ctx, dev.ID, KindTestCase, "CheckIn CRUD test", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, test.ID, model.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	// Verify all items
	err = s.engine.VerifyItem(s.ctx, bizReq.ID, "approved", "pm")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, screen.ID, "reviewed", "designer")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, model.ID, "implemented", "dev")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, test.ID, "passing", "dev")
	s.Require().NoError(err)

	// Change at root should cascade through the whole chain
	signals, err := s.engine.PropagateChange(s.ctx, bizReq.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(signals), 3, "all 3 downstream items should be affected")

	gotScreen, err := s.engine.GetItem(s.ctx, screen.ID)
	s.Require().NoError(err)
	gotModel, err := s.engine.GetItem(s.ctx, model.ID)
	s.Require().NoError(err)
	gotTest, err := s.engine.GetItem(s.ctx, test.ID)
	s.Require().NoError(err)

	s.Equal(StatusSuspect, gotScreen.Status)
	s.Equal(StatusSuspect, gotModel.Status)
	s.Equal(StatusSuspect, gotTest.Status)
}

func (s *ScenarioSuite) TestReconcileAfterPropagation() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	a, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "A", "", "")
	s.Require().NoError(err)
	b, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "B", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, b.ID, a.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	// Verify both, then propagate change from A
	err = s.engine.VerifyItem(s.ctx, a.ID, "proof", "dev")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, b.ID, "proof", "dev")
	s.Require().NoError(err)
	_, err = s.engine.PropagateChange(s.ctx, a.ID)
	s.Require().NoError(err)

	// B should be suspect
	gotB, err := s.engine.GetItem(s.ctx, b.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, gotB.Status)

	// Re-verify B
	err = s.engine.VerifyItem(s.ctx, b.ID, "re-checked, still valid", "dev")
	s.Require().NoError(err)

	gotB, err = s.engine.GetItem(s.ctx, b.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, gotB.Status)

	// Check transition history
	transitions, err := s.engine.GetItemTransitions(s.ctx, b.ID)
	s.Require().NoError(err)
	s.GreaterOrEqual(len(transitions), 3) // verify, suspect, re_verify
}

func (s *ScenarioSuite) TestAIAndHumanNodeCoexistence() {
	human, err := s.engine.RegisterNode(s.ctx, "dev-human", VerticalDev, "proj", "cuong", false)
	s.Require().NoError(err)
	ai, err := s.engine.RegisterNode(s.ctx, "dev-ai", VerticalDev, "proj", "claude", true)
	s.Require().NoError(err)

	// Both add items
	humanItem, err := s.engine.AddItem(s.ctx, human.ID, KindADR, "Human ADR", "", "")
	s.Require().NoError(err)
	aiItem, err := s.engine.AddItem(s.ctx, ai.ID, KindADR, "AI ADR", "", "")
	s.Require().NoError(err)

	// AI traces from human's work
	trace, err := s.engine.AddTrace(s.ctx, aiItem.ID, humanItem.ID, RelationTracedFrom, "claude")
	s.Require().NoError(err)
	s.Equal(ai.ID, trace.FromNodeID)
	s.Equal(human.ID, trace.ToNodeID)

	// AI can verify and the propagation works
	err = s.engine.VerifyItem(s.ctx, humanItem.ID, "approved", "cuong")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, aiItem.ID, "generated and verified", "claude")
	s.Require().NoError(err)

	signals, err := s.engine.PropagateChange(s.ctx, humanItem.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)

	gotAI, err := s.engine.GetItem(s.ctx, aiItem.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, gotAI.Status)
}

func (s *ScenarioSuite) TestNetworkQueryWorkflow() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	// Dev asks PM a question
	q, err := s.engine.AskNetwork(s.ctx, "dev-lead", dev.ID, "What's the priority for US-003?", "planning sprint", pm.ID)
	s.Require().NoError(err)
	s.Equal(pm.ID, q.TargetNode)

	// PM responds
	resp, err := s.engine.RespondToQuery(s.ctx, q.ID, "pm-lead", pm.ID, "High priority, ship by Friday", false)
	s.Require().NoError(err)
	s.Equal("High priority, ship by Friday", resp.Answer)
}

func TestScenarioSuite(t *testing.T) {
	suite.Run(t, new(ScenarioSuite))
}
