package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/suite"
)

// --- Store Checklist Suite ---

type StoreChecklistSuite struct {
	suite.Suite
	store *Store
	ctx   context.Context
}

func (s *StoreChecklistSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()
}

func (s *StoreChecklistSuite) TearDownTest() {
	s.store.Close()
}

func (s *StoreChecklistSuite) createNode(name string, vertical Vertical) *Node {
	n := &Node{Name: name, Vertical: vertical, Project: "test-project", Owner: "tester"}
	s.Require().NoError(s.store.CreateNode(s.ctx, n))
	return n
}

func (s *StoreChecklistSuite) createItem(nodeID, title string) *Item {
	item := &Item{NodeID: nodeID, Kind: KindADR, Title: title, Body: "body"}
	s.Require().NoError(s.store.CreateItem(s.ctx, item))
	return item
}

func (s *StoreChecklistSuite) TestCreateAndGetChecklistEntry() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	entry := &ChecklistEntry{
		ItemID:    item.ID,
		Criterion: "HIPAA compliant",
	}
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, entry))
	s.NotEmpty(entry.ID)

	got, err := s.store.GetChecklistEntry(s.ctx, entry.ID)
	s.Require().NoError(err)
	s.Equal("HIPAA compliant", got.Criterion)
	s.False(got.Checked)
	s.Empty(got.Proof)
	s.Empty(got.CheckedBy)
	s.Nil(got.CheckedAt)
}

func (s *StoreChecklistSuite) TestCheckAndUncheckEntry() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	entry := &ChecklistEntry{ItemID: item.ID, Criterion: "HIPAA compliant"}
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, entry))

	// Check it
	s.Require().NoError(s.store.CheckChecklistEntry(s.ctx, entry.ID, "Legal review v2.1", "duke"))

	got, err := s.store.GetChecklistEntry(s.ctx, entry.ID)
	s.Require().NoError(err)
	s.True(got.Checked)
	s.Equal("Legal review v2.1", got.Proof)
	s.Equal("duke", got.CheckedBy)
	s.NotNil(got.CheckedAt)

	// Uncheck it
	s.Require().NoError(s.store.UncheckChecklistEntry(s.ctx, entry.ID))

	got, err = s.store.GetChecklistEntry(s.ctx, entry.ID)
	s.Require().NoError(err)
	s.False(got.Checked)
	s.Empty(got.Proof)
	s.Empty(got.CheckedBy)
	s.Nil(got.CheckedAt)
}

func (s *StoreChecklistSuite) TestGetChecklistEntries() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	e1 := &ChecklistEntry{ItemID: item.ID, Criterion: "HIPAA compliant"}
	e2 := &ChecklistEntry{ItemID: item.ID, Criterion: "Supports offline"}
	e3 := &ChecklistEntry{ItemID: item.ID, Criterion: "Accessibility reviewed"}
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e1))
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e2))
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e3))

	entries, err := s.store.GetChecklistEntries(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Len(entries, 3)
}

func (s *StoreChecklistSuite) TestGetChecklistEntriesEmpty() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	entries, err := s.store.GetChecklistEntries(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Empty(entries)
}

func (s *StoreChecklistSuite) TestGetChecklistSummary() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	e1 := &ChecklistEntry{ItemID: item.ID, Criterion: "HIPAA compliant"}
	e2 := &ChecklistEntry{ItemID: item.ID, Criterion: "Supports offline"}
	e3 := &ChecklistEntry{ItemID: item.ID, Criterion: "Accessibility reviewed"}
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e1))
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e2))
	s.Require().NoError(s.store.CreateChecklistEntry(s.ctx, e3))

	// Check 2 of 3
	s.Require().NoError(s.store.CheckChecklistEntry(s.ctx, e1.ID, "Legal review", "duke"))
	s.Require().NoError(s.store.CheckChecklistEntry(s.ctx, e2.ID, "Tested offline", "duke"))

	summary, err := s.store.GetChecklistSummary(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(3, summary.Total)
	s.Equal(2, summary.Checked)
	s.Len(summary.Items, 3)
	s.Contains(summary.Items[0], "✓") // HIPAA
	s.Contains(summary.Items[1], "✓") // Offline
	s.Contains(summary.Items[2], "✗") // Accessibility
}

func (s *StoreChecklistSuite) TestGetChecklistSummaryEmpty() {
	node := s.createNode("dev", VerticalDev)
	item := s.createItem(node.ID, "ADR")

	summary, err := s.store.GetChecklistSummary(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(0, summary.Total)
	s.Equal(0, summary.Checked)
	s.Empty(summary.Items)
}

func (s *StoreChecklistSuite) TestGetChecklistEntryNotFound() {
	_, err := s.store.GetChecklistEntry(s.ctx, "nonexistent")
	s.Error(err)
}

func TestStoreChecklistSuite(t *testing.T) {
	suite.Run(t, new(StoreChecklistSuite))
}

// --- Engine Checklist Suite ---

type EngineChecklistSuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *EngineChecklistSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *EngineChecklistSuite) TearDownTest() {
	s.store.Close()
}

func (s *EngineChecklistSuite) TestAddChecklistEntry() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	entry, err := s.engine.AddChecklistEntry(s.ctx, item.ID, "HIPAA compliant")
	s.Require().NoError(err)
	s.NotEmpty(entry.ID)
	s.Equal("HIPAA compliant", entry.Criterion)
	s.False(entry.Checked)
}

func (s *EngineChecklistSuite) TestAddChecklistEntryInvalidItem() {
	_, err := s.engine.AddChecklistEntry(s.ctx, "nonexistent", "criterion")
	s.Error(err)
	s.Contains(err.Error(), "item not found")
}

func (s *EngineChecklistSuite) TestCheckEntry() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)
	entry, err := s.engine.AddChecklistEntry(s.ctx, item.ID, "HIPAA compliant")
	s.Require().NoError(err)

	err = s.engine.CheckEntry(s.ctx, entry.ID, "Legal review v2.1", "duke")
	s.Require().NoError(err)

	entries, err := s.engine.GetItemChecklist(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Len(entries, 1)
	s.True(entries[0].Checked)
	s.Equal("Legal review v2.1", entries[0].Proof)
}

func (s *EngineChecklistSuite) TestCheckEntryNotFound() {
	err := s.engine.CheckEntry(s.ctx, "nonexistent", "proof", "actor")
	s.Error(err)
	s.Contains(err.Error(), "checklist entry not found")
}

func (s *EngineChecklistSuite) TestUncheckEntry() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)
	entry, err := s.engine.AddChecklistEntry(s.ctx, item.ID, "HIPAA compliant")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, entry.ID, "proof", "duke")
	s.Require().NoError(err)

	err = s.engine.UncheckEntry(s.ctx, entry.ID)
	s.Require().NoError(err)

	entries, err := s.engine.GetItemChecklist(s.ctx, item.ID)
	s.Require().NoError(err)
	s.False(entries[0].Checked)
}

func (s *EngineChecklistSuite) TestUncheckEntryNotFound() {
	err := s.engine.UncheckEntry(s.ctx, "nonexistent")
	s.Error(err)
	s.Contains(err.Error(), "checklist entry not found")
}

func (s *EngineChecklistSuite) TestGetItemSummary() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "WebSocket ADR", "", "")
	s.Require().NoError(err)

	e1, err := s.engine.AddChecklistEntry(s.ctx, item.ID, "Arch reviewed")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, item.ID, "Test coverage")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e1.ID, "reviewed in meeting", "dev")
	s.Require().NoError(err)

	summary, err := s.engine.GetItemSummary(s.ctx, item.ID)
	s.Require().NoError(err)
	s.Equal(item.ID, summary.ID)
	s.Equal(node.ID, summary.NodeID)
	s.Equal(KindADR, summary.Kind)
	s.Equal("WebSocket ADR", summary.Title)
	s.Equal(StatusUnverified, summary.Status)
	s.Equal(2, summary.Checklist.Total)
	s.Equal(1, summary.Checklist.Checked)
}

func (s *EngineChecklistSuite) TestGetItemSummaryNotFound() {
	_, err := s.engine.GetItemSummary(s.ctx, "nonexistent")
	s.Error(err)
}

func (s *EngineChecklistSuite) TestGetNodeItemSummaries() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)
	item1, err := s.engine.AddItem(s.ctx, node.ID, KindADR, "ADR-1", "", "")
	s.Require().NoError(err)
	item2, err := s.engine.AddItem(s.ctx, node.ID, KindAPISpec, "API-1", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddChecklistEntry(s.ctx, item1.ID, "Reviewed")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, item2.ID, "Tested")
	s.Require().NoError(err)

	summaries, err := s.engine.GetNodeItemSummaries(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Len(summaries, 2)
	s.Equal(1, summaries[0].Checklist.Total)
	s.Equal(1, summaries[1].Checklist.Total)
}

func (s *EngineChecklistSuite) TestGetNodeItemSummariesEmpty() {
	node, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	summaries, err := s.engine.GetNodeItemSummaries(s.ctx, node.ID)
	s.Require().NoError(err)
	s.Empty(summaries)
}

func TestEngineChecklistSuite(t *testing.T) {
	suite.Run(t, new(EngineChecklistSuite))
}

// --- Audit Enhancement Suite ---

type AuditEnhancementSuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *AuditEnhancementSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *AuditEnhancementSuite) TearDownTest() {
	s.store.Close()
}

func (s *AuditEnhancementSuite) TestAuditMissingUpstreamRefs() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	design, err := s.engine.RegisterNode(s.ctx, "design", VerticalDesign, "proj", "designer", false)
	s.Require().NoError(err)

	pmStory, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	designSpec, err := s.engine.AddItem(s.ctx, design.ID, KindScreenSpec, "Screen", "", "")
	s.Require().NoError(err)
	designOrphan, err := s.engine.AddItem(s.ctx, design.ID, KindScreenSpec, "Orphan Screen", "", "")
	s.Require().NoError(err)

	// designSpec traces to PM item — has upstream ref
	_, err = s.engine.AddTrace(s.ctx, designSpec.ID, pmStory.ID, RelationTracedFrom, "designer")
	s.Require().NoError(err)

	// designOrphan has no traces — missing upstream ref

	report, err := s.engine.Audit(s.ctx, design.ID)
	s.Require().NoError(err)

	// designOrphan should be flagged for missing upstream ref
	s.Contains(report.MissingUpstreamRefs, designOrphan.ID)
	// designSpec has an upstream ref, should NOT be flagged
	s.NotContains(report.MissingUpstreamRefs, designSpec.ID)
}

func (s *AuditEnhancementSuite) TestAuditDevMissingBothUpstreams() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	design, err := s.engine.RegisterNode(s.ctx, "design", VerticalDesign, "proj", "designer", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "dev", false)
	s.Require().NoError(err)

	pmStory, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	designSpec, err := s.engine.AddItem(s.ctx, design.ID, KindScreenSpec, "Screen", "", "")
	s.Require().NoError(err)
	devADR, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)
	devNoRef, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "ADR No Ref", "", "")
	s.Require().NoError(err)

	// devADR traces to PM — has upstream ref (PM is upstream of Dev)
	_, err = s.engine.AddTrace(s.ctx, devADR.ID, pmStory.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)
	// Also trace to design
	_, err = s.engine.AddTrace(s.ctx, devADR.ID, designSpec.ID, RelationTracedFrom, "dev")
	s.Require().NoError(err)

	// devNoRef has no traces at all

	report, err := s.engine.Audit(s.ctx, dev.ID)
	s.Require().NoError(err)

	// devNoRef is missing upstream ref
	s.Contains(report.MissingUpstreamRefs, devNoRef.ID)
	// devADR has upstream refs, should not be flagged
	s.NotContains(report.MissingUpstreamRefs, devADR.ID)
}

func (s *AuditEnhancementSuite) TestAuditPMHasNoUpstreamRequirement() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	_, err = s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)

	report, err := s.engine.Audit(s.ctx, pm.ID)
	s.Require().NoError(err)

	// PM has no upstream verticals — should never flag missing upstream refs
	s.Empty(report.MissingUpstreamRefs)
}

func (s *AuditEnhancementSuite) TestAuditIncompleteChecklists() {
	node, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "pm", false)
	s.Require().NoError(err)
	item1, err := s.engine.AddItem(s.ctx, node.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	item2, err := s.engine.AddItem(s.ctx, node.ID, KindUserStory, "US-004", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddItem(s.ctx, node.ID, KindUserStory, "US-005", "", "")
	s.Require().NoError(err)

	// item1: 2 checked, 1 unchecked = incomplete
	e1, err := s.engine.AddChecklistEntry(s.ctx, item1.ID, "HIPAA")
	s.Require().NoError(err)
	e2, err := s.engine.AddChecklistEntry(s.ctx, item1.ID, "Offline")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, item1.ID, "Accessibility")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e1.ID, "proof", "pm")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e2.ID, "proof", "pm")
	s.Require().NoError(err)

	// item2: all checked = complete
	e4, err := s.engine.AddChecklistEntry(s.ctx, item2.ID, "HIPAA")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e4.ID, "proof", "pm")
	s.Require().NoError(err)

	// item3: no checklist = not flagged (only items WITH checklists are checked)

	report, err := s.engine.Audit(s.ctx, node.ID)
	s.Require().NoError(err)

	s.Len(report.IncompleteChecklists, 1)
	s.Contains(report.IncompleteChecklists, item1.ID)
	s.NotContains(report.IncompleteChecklists, item2.ID)
}

func TestAuditEnhancementSuite(t *testing.T) {
	suite.Run(t, new(AuditEnhancementSuite))
}

// --- Cross-Inventory Workflow Scenario Suite ---

type CrossInventorySuite struct {
	suite.Suite
	engine *Engine
	store  *Store
	ctx    context.Context
}

func (s *CrossInventorySuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store
	s.ctx = context.Background()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)
}

func (s *CrossInventorySuite) TearDownTest() {
	s.store.Close()
}

// TestPMDesignerDevWorkflow simulates the full PM → Designer → Dev workflow
// from the cross-inventory design.
func (s *CrossInventorySuite) TestPMDesignerDevWorkflow() {
	// Phase 1: PM creates items with checklists
	pm, err := s.engine.RegisterNode(s.ctx, "pm-node", VerticalPM, "clinic-checkin", "duke", false)
	s.Require().NoError(err)
	us, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "Kiosk check-in flow", "User can check in at kiosk", "")
	s.Require().NoError(err)

	// PM adds checklist
	hipaa, err := s.engine.AddChecklistEntry(s.ctx, us.ID, "HIPAA compliant")
	s.Require().NoError(err)
	offline, err := s.engine.AddChecklistEntry(s.ctx, us.ID, "Supports offline")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, us.ID, "Accessibility reviewed")
	s.Require().NoError(err)

	// PM checks criteria with proof
	err = s.engine.CheckEntry(s.ctx, hipaa.ID, "Legal review v2.1", "duke")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, offline.ID, "Tested with network disabled", "duke")
	s.Require().NoError(err)
	// a11y left unchecked

	// PM verifies the user story
	err = s.engine.VerifyItem(s.ctx, us.ID, "Product approved", "duke")
	s.Require().NoError(err)

	// Phase 2: Designer queries PM and creates designs
	design, err := s.engine.RegisterNode(s.ctx, "design-node", VerticalDesign, "clinic-checkin", "huy", false)
	s.Require().NoError(err)

	// Designer gets PM's item summary
	pmSummary, err := s.engine.GetItemSummary(s.ctx, us.ID)
	s.Require().NoError(err)
	s.Equal(3, pmSummary.Checklist.Total)
	s.Equal(2, pmSummary.Checklist.Checked)

	// Designer creates their item and traces to PM
	screen, err := s.engine.AddItem(s.ctx, design.ID, KindScreenSpec, "Check-in screen", "", "")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, screen.ID, us.ID, RelationTracedFrom, "huy")
	s.Require().NoError(err)

	// Designer adds own checklist
	uiCheck, err := s.engine.AddChecklistEntry(s.ctx, screen.ID, "UI/UX reviewed")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, screen.ID, "Transitions smooth")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, uiCheck.ID, "Design system approved", "huy")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, screen.ID, "Design reviewed", "huy")
	s.Require().NoError(err)

	// Phase 3: Dev queries both PM and Designer, creates items
	dev, err := s.engine.RegisterNode(s.ctx, "dev-node", VerticalDev, "clinic-checkin", "cuong", false)
	s.Require().NoError(err)

	adr, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "WebSocket ADR", "", "")
	s.Require().NoError(err)
	// Dev traces to BOTH PM and Designer outputs
	_, err = s.engine.AddTrace(s.ctx, adr.ID, us.ID, RelationTracedFrom, "cuong")
	s.Require().NoError(err)
	_, err = s.engine.AddTrace(s.ctx, adr.ID, screen.ID, RelationTracedFrom, "cuong")
	s.Require().NoError(err)

	// Dev adds own checklist
	archCheck, err := s.engine.AddChecklistEntry(s.ctx, adr.ID, "Architecture reviewed")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, adr.ID, "Test coverage")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, archCheck.ID, "Reviewed in arch meeting", "cuong")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, adr.ID, "Arch approved", "cuong")
	s.Require().NoError(err)

	// Audit checks:
	// PM has no upstream requirement
	pmReport, err := s.engine.Audit(s.ctx, pm.ID)
	s.Require().NoError(err)
	s.Empty(pmReport.MissingUpstreamRefs)

	// Designer should have upstream ref to PM
	designReport, err := s.engine.Audit(s.ctx, design.ID)
	s.Require().NoError(err)
	s.NotContains(designReport.MissingUpstreamRefs, screen.ID, "screen has trace to PM")

	// Dev should have upstream ref
	devReport, err := s.engine.Audit(s.ctx, dev.ID)
	s.Require().NoError(err)
	s.NotContains(devReport.MissingUpstreamRefs, adr.ID, "adr has traces to PM and Design")

	// Incomplete checklists
	s.Len(pmReport.IncompleteChecklists, 1, "PM item has unchecked a11y")
	s.Len(designReport.IncompleteChecklists, 1, "Design item has unchecked transitions")
	s.Len(devReport.IncompleteChecklists, 1, "Dev item has unchecked test coverage")
}

// TestUpstreamChangePropagatesWithChecklists verifies that when PM changes
// a user story, downstream items become suspect but their checklists remain intact.
func (s *CrossInventorySuite) TestUpstreamChangePropagatesWithChecklists() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "duke", false)
	s.Require().NoError(err)
	dev, err := s.engine.RegisterNode(s.ctx, "dev", VerticalDev, "proj", "cuong", false)
	s.Require().NoError(err)

	us, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-003", "", "")
	s.Require().NoError(err)
	adr, err := s.engine.AddItem(s.ctx, dev.ID, KindADR, "ADR", "", "")
	s.Require().NoError(err)

	_, err = s.engine.AddTrace(s.ctx, adr.ID, us.ID, RelationTracedFrom, "cuong")
	s.Require().NoError(err)

	// Add checklist to ADR
	e1, err := s.engine.AddChecklistEntry(s.ctx, adr.ID, "Arch reviewed")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e1.ID, "reviewed", "cuong")
	s.Require().NoError(err)

	// Verify both
	err = s.engine.VerifyItem(s.ctx, us.ID, "approved", "duke")
	s.Require().NoError(err)
	err = s.engine.VerifyItem(s.ctx, adr.ID, "approved", "cuong")
	s.Require().NoError(err)

	// PM changes user story → propagate
	signals, err := s.engine.PropagateChange(s.ctx, us.ID)
	s.Require().NoError(err)
	s.Len(signals, 1)

	// ADR is now suspect
	got, err := s.engine.GetItem(s.ctx, adr.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, got.Status)

	// But checklist is still intact
	entries, err := s.engine.GetItemChecklist(s.ctx, adr.ID)
	s.Require().NoError(err)
	s.Len(entries, 1)
	s.True(entries[0].Checked, "checklist entries survive status changes")

	// Item summary reflects suspect status with checked checklist
	summary, err := s.engine.GetItemSummary(s.ctx, adr.ID)
	s.Require().NoError(err)
	s.Equal(StatusSuspect, summary.Status)
	s.Equal(1, summary.Checklist.Checked)
}

// TestNodeSummariesForP2PQuery simulates a P2P query where Dev gets
// item summaries from PM's node.
func (s *CrossInventorySuite) TestNodeSummariesForP2PQuery() {
	pm, err := s.engine.RegisterNode(s.ctx, "pm", VerticalPM, "proj", "duke", false)
	s.Require().NoError(err)

	us1, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-001", "", "")
	s.Require().NoError(err)
	us2, err := s.engine.AddItem(s.ctx, pm.ID, KindUserStory, "US-002", "", "")
	s.Require().NoError(err)

	// US-001: all checked
	e1, err := s.engine.AddChecklistEntry(s.ctx, us1.ID, "HIPAA")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e1.ID, "proof", "duke")
	s.Require().NoError(err)

	// US-002: partially checked
	e2, err := s.engine.AddChecklistEntry(s.ctx, us2.ID, "HIPAA")
	s.Require().NoError(err)
	_, err = s.engine.AddChecklistEntry(s.ctx, us2.ID, "Offline")
	s.Require().NoError(err)
	err = s.engine.CheckEntry(s.ctx, e2.ID, "proof", "duke")
	s.Require().NoError(err)

	err = s.engine.VerifyItem(s.ctx, us1.ID, "approved", "duke")
	s.Require().NoError(err)

	summaries, err := s.engine.GetNodeItemSummaries(s.ctx, pm.ID)
	s.Require().NoError(err)
	s.Len(summaries, 2)

	// Find each summary
	var sum1, sum2 ItemSummary
	for _, sum := range summaries {
		if sum.ID == us1.ID {
			sum1 = sum
		} else {
			sum2 = sum
		}
	}

	s.Equal(StatusProven, sum1.Status)
	s.Equal(1, sum1.Checklist.Total)
	s.Equal(1, sum1.Checklist.Checked)

	s.Equal(StatusUnverified, sum2.Status)
	s.Equal(2, sum2.Checklist.Total)
	s.Equal(1, sum2.Checklist.Checked)

	// Summaries contain criterion names but not proof
	s.Contains(sum2.Checklist.Items[0], "HIPAA")
	s.NotContains(sum2.Checklist.Items[0], "proof") // proof text stays local
}

func TestCrossInventorySuite(t *testing.T) {
	suite.Run(t, new(CrossInventorySuite))
}
