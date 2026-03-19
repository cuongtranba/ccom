package main

import (
	"context"
	"fmt"
	"time"
)

type Engine struct {
	store      *Store
	propagator *SignalPropagator
	crSM       *CRStateMachine
}

func NewEngine(store *Store, propagator *SignalPropagator, crSM *CRStateMachine) *Engine {
	return &Engine{store: store, propagator: propagator, crSM: crSM}
}

func (e *Engine) RegisterNode(ctx context.Context, name string, vertical Vertical, project string, owner string, isAI bool) (*Node, error) {
	node := &Node{
		Name:     name,
		Vertical: vertical,
		Project:  project,
		Owner:    owner,
		IsAI:     isAI,
	}
	if err := e.store.CreateNode(ctx, node); err != nil {
		return nil, fmt.Errorf("register node: %w", err)
	}
	return node, nil
}

func (e *Engine) AddItem(ctx context.Context, nodeID string, kind ItemKind, title, body, externalRef string) (*Item, error) {
	if _, err := e.store.GetNode(ctx, nodeID); err != nil {
		return nil, fmt.Errorf("node not found: %w", err)
	}

	item := &Item{
		NodeID:      nodeID,
		Kind:        kind,
		Title:       title,
		Body:        body,
		ExternalRef: externalRef,
	}
	if err := e.store.CreateItem(ctx, item); err != nil {
		return nil, fmt.Errorf("create item: %w", err)
	}
	return item, nil
}

func (e *Engine) AddTrace(ctx context.Context, fromItemID, toItemID string, relation TraceRelation, confirmedBy string) (*Trace, error) {
	fromItem, err := e.store.GetItem(ctx, fromItemID)
	if err != nil {
		return nil, fmt.Errorf("from item not found: %w", err)
	}
	toItem, err := e.store.GetItem(ctx, toItemID)
	if err != nil {
		return nil, fmt.Errorf("to item not found: %w", err)
	}

	now := time.Now()
	trace := &Trace{
		FromItemID:  fromItemID,
		FromNodeID:  fromItem.NodeID,
		ToItemID:    toItemID,
		ToNodeID:    toItem.NodeID,
		Relation:    relation,
		ConfirmedBy: confirmedBy,
		ConfirmedAt: &now,
	}
	if err := e.store.CreateTrace(ctx, trace); err != nil {
		return nil, fmt.Errorf("create trace: %w", err)
	}
	return trace, nil
}

func (e *Engine) VerifyItem(ctx context.Context, itemID string, evidence string, actor string) error {
	item, err := e.store.GetItem(ctx, itemID)
	if err != nil {
		return fmt.Errorf("get item: %w", err)
	}

	sm := NewStateMachine()
	var kind TransitionKind
	switch item.Status {
	case StatusUnverified:
		kind = TransitionVerify
	case StatusSuspect:
		kind = TransitionReVerify
	case StatusBroke:
		kind = TransitionFix
	default:
		return fmt.Errorf("item %s is already %s", itemID, item.Status)
	}

	t := Transition{
		Kind:      kind,
		From:      item.Status,
		Evidence:  evidence,
		Reason:    fmt.Sprintf("Verified by %s", actor),
		Actor:     actor,
		Timestamp: time.Now(),
	}

	newStatus, err := sm.Apply(t)
	if err != nil {
		return fmt.Errorf("transition failed: %w", err)
	}

	if err := e.store.UpdateItemWithEvidence(ctx, itemID, newStatus, evidence, actor); err != nil {
		return fmt.Errorf("update item: %w", err)
	}

	t.To = newStatus
	return e.store.RecordTransition(ctx, itemID, &t)
}

func (e *Engine) MarkBroken(ctx context.Context, itemID string, reason string, actor string) error {
	item, err := e.store.GetItem(ctx, itemID)
	if err != nil {
		return fmt.Errorf("get item: %w", err)
	}

	sm := NewStateMachine()
	t := Transition{
		Kind:      TransitionBreak,
		From:      item.Status,
		Reason:    reason,
		Actor:     actor,
		Timestamp: time.Now(),
	}

	newStatus, err := sm.Apply(t)
	if err != nil {
		return fmt.Errorf("transition failed: %w", err)
	}

	if err := e.store.UpdateItemStatus(ctx, itemID, newStatus); err != nil {
		return fmt.Errorf("update item: %w", err)
	}

	t.To = newStatus
	return e.store.RecordTransition(ctx, itemID, &t)
}

func (e *Engine) PropagateChange(ctx context.Context, itemID string) ([]Signal, error) {
	return e.propagator.PropagateChange(ctx, itemID)
}

func (e *Engine) ComputeImpact(ctx context.Context, itemID string) ([]Item, error) {
	return e.propagator.ComputeImpact(ctx, itemID)
}

func (e *Engine) Audit(ctx context.Context, nodeID string) (*AuditReport, error) {
	return e.store.AuditNode(ctx, nodeID)
}

func (e *Engine) CreateCR(ctx context.Context, title, description, proposerID, nodeID string, affectedItems []string) (*ChangeRequest, error) {
	cr := &ChangeRequest{
		Title:         title,
		Description:   description,
		ProposerID:    proposerID,
		NodeID:        nodeID,
		AffectedItems: affectedItems,
	}
	if err := e.store.CreateChangeRequest(ctx, cr); err != nil {
		return nil, fmt.Errorf("create CR: %w", err)
	}
	return cr, nil
}

func (e *Engine) SubmitCR(ctx context.Context, crID string) error {
	cr, err := e.store.GetChangeRequest(ctx, crID)
	if err != nil {
		return fmt.Errorf("get CR: %w", err)
	}
	newStatus, err := e.crSM.Apply(cr.Status, CRSubmit)
	if err != nil {
		return err
	}
	return e.store.UpdateCRStatus(ctx, crID, newStatus)
}

func (e *Engine) OpenVoting(ctx context.Context, crID string) error {
	cr, err := e.store.GetChangeRequest(ctx, crID)
	if err != nil {
		return fmt.Errorf("get CR: %w", err)
	}
	newStatus, err := e.crSM.Apply(cr.Status, CROpen)
	if err != nil {
		return err
	}
	return e.store.UpdateCRStatus(ctx, crID, newStatus)
}

func (e *Engine) CastVote(ctx context.Context, crID, nodeID, voterID string, decision VoteDecision, reason string, isAI bool) error {
	vote := &Vote{
		CRID:     crID,
		NodeID:   nodeID,
		VoterID:  voterID,
		Decision: decision,
		Reason:   reason,
		IsAI:     isAI,
	}
	return e.store.CreateVote(ctx, vote)
}

func (e *Engine) TallyVotes(ctx context.Context, crID string) (VoteDecision, error) {
	votes, err := e.store.GetVotesForCR(ctx, crID)
	if err != nil {
		return "", fmt.Errorf("get votes: %w", err)
	}

	if len(votes) == 0 {
		return "", fmt.Errorf("no votes yet")
	}

	// Only count human votes — AI votes are advisory-only per governance rules
	counts := map[VoteDecision]int{}
	humanVoteCount := 0
	for _, v := range votes {
		if v.IsAI {
			continue
		}
		counts[v.Decision]++
		humanVoteCount++
	}

	if humanVoteCount == 0 {
		return "", fmt.Errorf("no human votes yet (AI votes are advisory-only)")
	}

	if counts[VoteReject] > 0 {
		return VoteReject, nil
	}
	if counts[VoteRequestChanges] > 0 {
		return VoteRequestChanges, nil
	}
	return VoteApprove, nil
}

func (e *Engine) ResolveCR(ctx context.Context, crID string) error {
	cr, err := e.store.GetChangeRequest(ctx, crID)
	if err != nil {
		return fmt.Errorf("get CR: %w", err)
	}

	decision, err := e.TallyVotes(ctx, crID)
	if err != nil {
		return err
	}

	var kind CRTransitionKind
	switch decision {
	case VoteApprove:
		kind = CRApprove
	case VoteReject, VoteRequestChanges:
		kind = CRReject
	default:
		return fmt.Errorf("unexpected tally result: %s", decision)
	}

	newStatus, err := e.crSM.Apply(cr.Status, kind)
	if err != nil {
		return err
	}
	return e.store.UpdateCRStatus(ctx, crID, newStatus)
}

func (e *Engine) AskNetwork(ctx context.Context, askerID, askerNode, question, queryCtx, targetNode string) (*Query, error) {
	q := &Query{
		AskerID:    askerID,
		AskerNode:  askerNode,
		Question:   question,
		Context:    queryCtx,
		TargetNode: targetNode,
	}
	if err := e.store.CreateQuery(ctx, q); err != nil {
		return nil, fmt.Errorf("create query: %w", err)
	}
	return q, nil
}

func (e *Engine) RespondToQuery(ctx context.Context, queryID, responderID, nodeID, answer string, isAI bool) (*QueryResponse, error) {
	resp := &QueryResponse{
		QueryID:     queryID,
		ResponderID: responderID,
		NodeID:      nodeID,
		Answer:      answer,
		IsAI:        isAI,
	}
	if err := e.store.CreateQueryResponse(ctx, resp); err != nil {
		return nil, fmt.Errorf("create response: %w", err)
	}
	return resp, nil
}

func (e *Engine) GetNode(ctx context.Context, id string) (*Node, error) {
	return e.store.GetNode(ctx, id)
}

func (e *Engine) ListNodes(ctx context.Context, project string) ([]Node, error) {
	return e.store.ListNodes(ctx, project)
}

func (e *Engine) GetItem(ctx context.Context, id string) (*Item, error) {
	return e.store.GetItem(ctx, id)
}

func (e *Engine) ListItems(ctx context.Context, nodeID string) ([]Item, error) {
	return e.store.ListItems(ctx, nodeID)
}

func (e *Engine) GetItemTraces(ctx context.Context, itemID string) ([]Trace, error) {
	return e.store.GetItemTraces(ctx, itemID)
}

func (e *Engine) GetItemTransitions(ctx context.Context, itemID string) ([]Transition, error) {
	return e.store.GetItemTransitions(ctx, itemID)
}

// --- Checklist ---

func (e *Engine) AddChecklistEntry(ctx context.Context, itemID string, criterion string) (*ChecklistEntry, error) {
	if _, err := e.store.GetItem(ctx, itemID); err != nil {
		return nil, fmt.Errorf("item not found: %w", err)
	}

	entry := &ChecklistEntry{
		ItemID:    itemID,
		Criterion: criterion,
	}
	if err := e.store.CreateChecklistEntry(ctx, entry); err != nil {
		return nil, fmt.Errorf("create checklist entry: %w", err)
	}
	return entry, nil
}

func (e *Engine) CheckEntry(ctx context.Context, entryID string, proof string, actor string) error {
	if _, err := e.store.GetChecklistEntry(ctx, entryID); err != nil {
		return fmt.Errorf("checklist entry not found: %w", err)
	}
	return e.store.CheckChecklistEntry(ctx, entryID, proof, actor)
}

func (e *Engine) UncheckEntry(ctx context.Context, entryID string) error {
	if _, err := e.store.GetChecklistEntry(ctx, entryID); err != nil {
		return fmt.Errorf("checklist entry not found: %w", err)
	}
	return e.store.UncheckChecklistEntry(ctx, entryID)
}

func (e *Engine) GetItemChecklist(ctx context.Context, itemID string) ([]ChecklistEntry, error) {
	return e.store.GetChecklistEntries(ctx, itemID)
}

func (e *Engine) GetItemSummary(ctx context.Context, itemID string) (*ItemSummary, error) {
	item, err := e.store.GetItem(ctx, itemID)
	if err != nil {
		return nil, fmt.Errorf("get item: %w", err)
	}

	checklistSummary, err := e.store.GetChecklistSummary(ctx, itemID)
	if err != nil {
		return nil, fmt.Errorf("get checklist summary: %w", err)
	}

	return &ItemSummary{
		ID:        item.ID,
		NodeID:    item.NodeID,
		Kind:      item.Kind,
		Title:     item.Title,
		Status:    item.Status,
		Checklist: checklistSummary,
	}, nil
}

func (e *Engine) GetNodeItemSummaries(ctx context.Context, nodeID string) ([]ItemSummary, error) {
	items, err := e.store.ListItems(ctx, nodeID)
	if err != nil {
		return nil, fmt.Errorf("list items: %w", err)
	}

	summaries := make([]ItemSummary, 0, len(items))
	for _, item := range items {
		checklistSummary, err := e.store.GetChecklistSummary(ctx, item.ID)
		if err != nil {
			return nil, fmt.Errorf("get checklist summary for %s: %w", item.ID, err)
		}
		summaries = append(summaries, ItemSummary{
			ID:        item.ID,
			NodeID:    item.NodeID,
			Kind:      item.Kind,
			Title:     item.Title,
			Status:    item.Status,
			Checklist: checklistSummary,
		})
	}
	return summaries, nil
}

// --- Query ---

type QueryFilter struct {
	Text        string
	Kind        ItemKind
	Status      ItemStatus
	NodeID      string
	ExternalRef string
}

func (e *Engine) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error) {
	return e.store.QueryItems(ctx, f)
}

// --- Sweep ---

type SweepResult struct {
	TriggerRef    string `json:"trigger_ref"`
	MatchedItems  []Item `json:"matched_items"`
	AffectedItems []Item `json:"affected_items"`
	SignalsCreated int   `json:"signals_created"`
}

func (e *Engine) Sweep(ctx context.Context, externalRef string) (*SweepResult, error) {
	matched, err := e.store.FindItemsByExternalRef(ctx, externalRef)
	if err != nil {
		return nil, fmt.Errorf("find items by ref: %w", err)
	}

	result := &SweepResult{
		TriggerRef:   externalRef,
		MatchedItems: matched,
	}

	seen := make(map[string]bool)
	for _, item := range matched {
		signals, err := e.PropagateChange(ctx, item.ID)
		if err != nil {
			return nil, fmt.Errorf("propagate from %s: %w", item.ID, err)
		}
		result.SignalsCreated += len(signals)

		affected, err := e.ComputeImpact(ctx, item.ID)
		if err != nil {
			return nil, fmt.Errorf("compute impact for %s: %w", item.ID, err)
		}

		for _, dep := range affected {
			if seen[dep.ID] {
				continue
			}
			seen[dep.ID] = true
			refreshed, err := e.store.GetItem(ctx, dep.ID)
			if err != nil {
				return nil, fmt.Errorf("refresh item %s: %w", dep.ID, err)
			}
			result.AffectedItems = append(result.AffectedItems, *refreshed)
		}
	}

	return result, nil
}

// --- Reconciliation ---

func (e *Engine) StartReconciliation(ctx context.Context, triggerRef, nodeID, actor string) (*ReconciliationSession, error) {
	if _, err := e.store.GetNode(ctx, nodeID); err != nil {
		return nil, fmt.Errorf("node not found: %w", err)
	}

	sess := &ReconciliationSession{
		TriggerRef: triggerRef,
		NodeID:     nodeID,
		StartedBy:  actor,
	}
	if err := e.store.CreateReconciliationSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	suspectItems, err := e.store.GetItemsByNodeAndStatus(ctx, nodeID, StatusSuspect)
	if err != nil {
		return nil, fmt.Errorf("get suspect items: %w", err)
	}

	sess.Entries = make([]ReconciliationEntry, 0, len(suspectItems))
	for _, item := range suspectItems {
		sess.Entries = append(sess.Entries, ReconciliationEntry{
			SessionID: sess.ID,
			ItemID:    item.ID,
			Decision:  "pending",
		})
	}

	return sess, nil
}

func (e *Engine) ResolveItem(ctx context.Context, sessionID, itemID, decision, evidence, actor string) (*ReconciliationEntry, error) {
	sess, err := e.store.GetReconciliationSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if sess.Status != "open" {
		return nil, fmt.Errorf("session %s is %s, not open", sessionID, sess.Status)
	}

	switch decision {
	case "re_verified":
		if err := e.VerifyItem(ctx, itemID, evidence, actor); err != nil {
			return nil, fmt.Errorf("verify item: %w", err)
		}
	case "marked_broke":
		if err := e.MarkBroken(ctx, itemID, evidence, actor); err != nil {
			return nil, fmt.Errorf("mark broken: %w", err)
		}
	case "deferred":
		// No state change, just record the decision
	default:
		return nil, fmt.Errorf("invalid decision: %s (must be re_verified, marked_broke, or deferred)", decision)
	}

	entry := &ReconciliationEntry{
		SessionID: sessionID,
		ItemID:    itemID,
		Decision:  decision,
		Evidence:  evidence,
		Actor:     actor,
	}
	if err := e.store.CreateReconciliationEntry(ctx, entry); err != nil {
		return nil, fmt.Errorf("create entry: %w", err)
	}
	return entry, nil
}

func (e *Engine) CompleteReconciliation(ctx context.Context, sessionID string) (*ReconciliationSession, error) {
	sess, err := e.store.GetReconciliationSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if sess.Status != "open" {
		return nil, fmt.Errorf("session %s is %s, not open", sessionID, sess.Status)
	}

	if err := e.store.CompleteReconciliationSession(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("complete session: %w", err)
	}

	return e.store.GetReconciliationSession(ctx, sessionID)
}

// --- Trace Up / Down ---

type TraceChainEntry struct {
	Depth    int           `json:"depth"`
	Item     Item          `json:"item"`
	Relation TraceRelation `json:"relation"`
}

func (e *Engine) TraceUp(ctx context.Context, itemID string) ([]TraceChainEntry, error) {
	visited := make(map[string]bool)
	return e.collectTraceUp(ctx, itemID, visited, 0)
}

func (e *Engine) collectTraceUp(ctx context.Context, itemID string, visited map[string]bool, depth int) ([]TraceChainEntry, error) {
	if visited[itemID] {
		return nil, nil
	}
	visited[itemID] = true

	traces, err := e.store.GetUpstreamTraces(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var chain []TraceChainEntry
	for _, t := range traces {
		if visited[t.ToItemID] {
			continue
		}
		item, err := e.store.GetItem(ctx, t.ToItemID)
		if err != nil {
			return nil, err
		}
		chain = append(chain, TraceChainEntry{
			Depth:    depth + 1,
			Item:     *item,
			Relation: t.Relation,
		})

		deeper, err := e.collectTraceUp(ctx, t.ToItemID, visited, depth+1)
		if err != nil {
			return nil, err
		}
		chain = append(chain, deeper...)
	}
	return chain, nil
}

func (e *Engine) TraceDown(ctx context.Context, itemID string) ([]TraceChainEntry, error) {
	visited := make(map[string]bool)
	return e.collectTraceDown(ctx, itemID, visited, 0)
}

func (e *Engine) collectTraceDown(ctx context.Context, itemID string, visited map[string]bool, depth int) ([]TraceChainEntry, error) {
	if visited[itemID] {
		return nil, nil
	}
	visited[itemID] = true

	traces, err := e.store.GetDependentTraces(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var chain []TraceChainEntry
	for _, t := range traces {
		if visited[t.FromItemID] {
			continue
		}
		item, err := e.store.GetItem(ctx, t.FromItemID)
		if err != nil {
			return nil, err
		}
		chain = append(chain, TraceChainEntry{
			Depth:    depth + 1,
			Item:     *item,
			Relation: t.Relation,
		})

		deeper, err := e.collectTraceDown(ctx, t.FromItemID, visited, depth+1)
		if err != nil {
			return nil, err
		}
		chain = append(chain, deeper...)
	}
	return chain, nil
}
