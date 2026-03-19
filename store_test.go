package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

type StoreSuite struct {
	suite.Suite
	store *Store
	ctx   context.Context
}

func (s *StoreSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()
}

func (s *StoreSuite) TearDownTest() {
	s.store.Close()
}

func (s *StoreSuite) createNode(name string, vertical Vertical) *Node {
	n := &Node{Name: name, Vertical: vertical, Project: "test-project", Owner: "tester"}
	s.Require().NoError(s.store.CreateNode(s.ctx, n))
	return n
}

func (s *StoreSuite) createItem(nodeID, title string) *Item {
	item := &Item{NodeID: nodeID, Kind: KindADR, Title: title, Body: "body"}
	s.Require().NoError(s.store.CreateItem(s.ctx, item))
	return item
}

func (s *StoreSuite) createTrace(fromItem, fromNode, toItem, toNode string, relation TraceRelation) *Trace {
	t := &Trace{
		FromItemID: fromItem, FromNodeID: fromNode,
		ToItemID: toItem, ToNodeID: toNode,
		Relation: relation, ConfirmedBy: "tester",
	}
	s.Require().NoError(s.store.CreateTrace(s.ctx, t))
	return t
}

// --- Node tests ---

func (s *StoreSuite) TestCreateAndGetNode() {
	node := s.createNode("dev-node", VerticalDev)

	got, err := s.store.GetNode(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Equal("dev-node", got.Name)
	s.Equal(VerticalDev, got.Vertical)
	s.Equal("test-project", got.Project)
	s.Equal("tester", got.Owner)
	s.False(got.IsAI)
}

func (s *StoreSuite) TestCreateAINode() {
	n := &Node{Name: "ai-node", Vertical: VerticalDev, Project: "proj", Owner: "bot", IsAI: true}
	s.Require().NoError(s.store.CreateNode(s.ctx, n))

	got, err := s.store.GetNode(s.ctx, n.ID)
	s.Require().NoError(err)
	s.True(got.IsAI)
}

func (s *StoreSuite) TestListNodes() {
	s.createNode("node-1", VerticalDev)
	s.createNode("node-2", VerticalPM)

	nodes, err := s.store.ListNodes(s.ctx, "test-project")
	s.Require().NoError(err)
	s.Len(nodes, 2)
}

func (s *StoreSuite) TestListNodesFiltersByProject() {
	s.createNode("node-1", VerticalDev)

	other := &Node{Name: "other", Vertical: VerticalDev, Project: "other-project", Owner: "x"}
	s.Require().NoError(s.store.CreateNode(s.ctx, other))

	nodes, err := s.store.ListNodes(s.ctx, "test-project")
	s.Require().NoError(err)
	s.Len(nodes, 1)
}

func (s *StoreSuite) TestGetNodeNotFound() {
	_, err := s.store.GetNode(s.ctx, "nonexistent")
	s.Error(err)
}

// --- Item tests ---

func (s *StoreSuite) TestCreateAndGetItem() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "Test ADR")

	got, err := s.store.GetItem(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal("Test ADR", got.Title)
	s.Equal(KindADR, got.Kind)
	s.Equal(StatusUnverified, got.Status)
	s.Equal(1, got.Version)
	s.Equal("body", got.Body)
}

func (s *StoreSuite) TestListItems() {
	node := s.createNode("dev", VerticalDev)
	s.createItem(node.ID, "Item 1")
	s.createItem(node.ID, "Item 2")
	s.createItem(node.ID, "Item 3")

	items, err := s.store.ListItems(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Len(items, 3)
}

func (s *StoreSuite) TestListItemsEmpty() {
	node := s.createNode("dev", VerticalDev)

	items, err := s.store.ListItems(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Empty(items)
}

func (s *StoreSuite) TestUpdateItemStatus() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	s.Require().NoError(s.store.UpdateItemStatus(s.ctx, item.ID, StatusProven))

	got, err := s.store.GetItem(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, got.Status)
}

func (s *StoreSuite) TestUpdateItemWithEvidence() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	s.Require().NoError(s.store.UpdateItemWithEvidence(s.ctx, item.ID, StatusProven, "test passed", "dev"))

	got, err := s.store.GetItem(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(StatusProven, got.Status)
	s.Equal("test passed", got.Evidence)
	s.Equal("dev", got.ConfirmedBy)
	s.NotNil(got.ConfirmedAt)
	s.Equal(2, got.Version)
}

func (s *StoreSuite) TestGetItemsByNodeAndStatus() {
	node := s.createNode("dev", VerticalDev)
	item1 := s.createItem(node.ID, "ADR 1")
	s.createItem(node.ID, "ADR 2")

	s.Require().NoError(s.store.UpdateItemStatus(s.ctx, item1.ID, StatusProven))

	proven, err := s.store.GetItemsByNodeAndStatus(s.ctx, node.ID, StatusProven)
	s.Require().NoError(err)
	s.Len(proven, 1)
	s.Equal(item1.ID, proven[0].ID)

	unverified, err := s.store.GetItemsByNodeAndStatus(s.ctx, node.ID, StatusUnverified)
	s.Require().NoError(err)
	s.Len(unverified, 1)
}

// --- Trace tests ---

func (s *StoreSuite) TestCreateAndGetTraces() {
	node := s.createNode("dev", VerticalDev)
	item1 := s.createItem(node.ID, "ADR-1")
	item2 := s.createItem(node.ID, "ADR-2")

	s.createTrace(item1.ID, node.ID, item2.ID, node.ID, RelationTracedFrom)

	traces, err := s.store.GetItemTraces(s.ctx, item1.ID)
	s.Require().NoError(err)
	s.Len(traces, 1)
	s.Equal(RelationTracedFrom, traces[0].Relation)
}

func (s *StoreSuite) TestGetDependentTraces() {
	node := s.createNode("dev", VerticalDev)
	a := s.createItem(node.ID, "A")
	b := s.createItem(node.ID, "B")
	c := s.createItem(node.ID, "C")

	// B and C both trace from A
	s.createTrace(b.ID, node.ID, a.ID, node.ID, RelationTracedFrom)
	s.createTrace(c.ID, node.ID, a.ID, node.ID, RelationTracedFrom)

	deps, err := s.store.GetDependentTraces(s.ctx, a.ID)
	s.Require().NoError(err)
	s.Len(deps, 2)
}

func (s *StoreSuite) TestGetItemTracesShowsBothDirections() {
	node := s.createNode("dev", VerticalDev)
	a := s.createItem(node.ID, "A")
	b := s.createItem(node.ID, "B")
	c := s.createItem(node.ID, "C")

	// A traces from B, C traces from A
	s.createTrace(a.ID, node.ID, b.ID, node.ID, RelationTracedFrom)
	s.createTrace(c.ID, node.ID, a.ID, node.ID, RelationTracedFrom)

	traces, err := s.store.GetItemTraces(s.ctx, a.ID)
	s.Require().NoError(err)
	s.Len(traces, 2) // one upstream, one downstream
}

// --- Signal tests ---

func (s *StoreSuite) TestCreateAndProcessSignal() {
	sig := &Signal{
		ID:         "sig-1",
		Kind:       SignalChange,
		SourceItem: "item-1",
		SourceNode: "node-1",
		TargetItem: "item-2",
		TargetNode: "node-2",
		Payload:    "test",
	}
	s.Require().NoError(s.store.CreateSignal(s.ctx, sig))
	s.Require().NoError(s.store.MarkSignalProcessed(s.ctx, "sig-1"))
}

// --- Transition tests ---

func (s *StoreSuite) TestRecordAndGetTransitions() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	t1 := &Transition{
		Kind: TransitionVerify, From: StatusUnverified, To: StatusProven,
		Evidence: "proof", Actor: "dev", Timestamp: item.CreatedAt,
	}
	s.Require().NoError(s.store.RecordTransition(s.ctx, item.ID, t1))

	transitions, err := s.store.GetItemTransitions(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Len(transitions, 1)
	s.Equal(TransitionVerify, transitions[0].Kind)
	s.Equal(StatusUnverified, transitions[0].From)
	s.Equal(StatusProven, transitions[0].To)
}

// --- Change Request tests ---

func (s *StoreSuite) TestCRLifecycle() {
	node := s.createNode("dev", VerticalDev)

	cr := &ChangeRequest{
		Title:         "Add WebSocket",
		Description:   "Replace polling",
		ProposerID:    "dev-lead",
		NodeID:        node.ID,
		AffectedItems: []string{"item-1", "item-2"},
	}
	s.Require().NoError(s.store.CreateChangeRequest(s.ctx, cr))
	s.Equal(CRDraft, cr.Status)

	got, err := s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal("Add WebSocket", got.Title)
	s.Len(got.AffectedItems, 2)

	s.Require().NoError(s.store.UpdateCRStatus(s.ctx, cr.ID, CRProposed))
	got, err = s.store.GetChangeRequest(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Equal(CRProposed, got.Status)
}

// --- Vote tests ---

func (s *StoreSuite) TestVoteCRUD() {
	node := s.createNode("dev", VerticalDev)
	cr := &ChangeRequest{Title: "CR", ProposerID: "p", NodeID: node.ID}
	s.Require().NoError(s.store.CreateChangeRequest(s.ctx, cr))

	vote := &Vote{
		CRID: cr.ID, NodeID: node.ID, VoterID: "voter-1",
		Decision: VoteApprove, Reason: "looks good",
	}
	s.Require().NoError(s.store.CreateVote(s.ctx, vote))

	votes, err := s.store.GetVotesForCR(s.ctx, cr.ID)
	s.Require().NoError(err)
	s.Len(votes, 1)
	s.Equal(VoteApprove, votes[0].Decision)
}

// --- Query tests ---

func (s *StoreSuite) TestCreateQuery() {
	q := &Query{
		AskerID:   "user-1",
		AskerNode: "node-1",
		Question:  "What uses the check-in API?",
		Context:   "investigating deps",
	}
	s.Require().NoError(s.store.CreateQuery(s.ctx, q))
	s.NotEmpty(q.ID)
}

func (s *StoreSuite) TestCreateQueryResponse() {
	q := &Query{AskerID: "u", AskerNode: "n", Question: "q"}
	s.Require().NoError(s.store.CreateQuery(s.ctx, q))

	r := &QueryResponse{
		QueryID: q.ID, ResponderID: "r", NodeID: "n", Answer: "answer",
	}
	s.Require().NoError(s.store.CreateQueryResponse(s.ctx, r))
	s.NotEmpty(r.ID)
}

// --- Audit tests ---

func (s *StoreSuite) TestAuditNode() {
	node := s.createNode("dev", VerticalDev)
	item1 := s.createItem(node.ID, "ADR-1")
	item2 := s.createItem(node.ID, "ADR-2")
	item3 := s.createItem(node.ID, "ADR-3")

	// item1: proven with trace
	s.Require().NoError(s.store.UpdateItemStatus(s.ctx, item1.ID, StatusProven))
	s.createTrace(item1.ID, node.ID, item2.ID, node.ID, RelationTracedFrom)

	// item2: suspect with trace (from item1's trace)
	s.Require().NoError(s.store.UpdateItemStatus(s.ctx, item2.ID, StatusSuspect))

	// item3: unverified, no traces (orphan)

	report, err := s.store.AuditNode(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Equal(3, report.TotalItems)
	s.Len(report.Proven, 1)
	s.Len(report.Suspect, 1)
	s.Len(report.Unverified, 1)
	s.Len(report.Orphans, 1) // item3 has no traces
	s.Equal(item3.ID, report.Orphans[0])
}

func TestStoreSuite(t *testing.T) {
	suite.Run(t, new(StoreSuite))
}
