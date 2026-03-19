package main

import (
	"fmt"
	"time"
)

type ItemStatus string

const (
	StatusUnverified ItemStatus = "unverified"
	StatusProven     ItemStatus = "proven"
	StatusSuspect    ItemStatus = "suspect"
	StatusBroke      ItemStatus = "broke"
)

type TransitionKind string

const (
	TransitionVerify   TransitionKind = "verify"
	TransitionSuspect  TransitionKind = "suspect"
	TransitionReVerify TransitionKind = "re_verify"
	TransitionBreak    TransitionKind = "break"
	TransitionFix      TransitionKind = "fix"
)

type Transition struct {
	Kind      TransitionKind
	From      ItemStatus
	To        ItemStatus
	Evidence  string
	Reason    string
	Actor     string
	Timestamp time.Time
}

type TransitionRule struct {
	From             ItemStatus
	To               ItemStatus
	Kind             TransitionKind
	RequiresEvidence bool
	RequiresReason   bool
}

var transitionRules = []TransitionRule{
	{StatusUnverified, StatusProven, TransitionVerify, true, false},
	{StatusProven, StatusSuspect, TransitionSuspect, false, true},
	{StatusSuspect, StatusProven, TransitionReVerify, true, true},
	{StatusSuspect, StatusBroke, TransitionBreak, false, true},
	{StatusBroke, StatusProven, TransitionFix, true, true},
}

type StateMachine struct {
	rules map[ItemStatus]map[TransitionKind]TransitionRule
}

func NewStateMachine() *StateMachine {
	sm := &StateMachine{
		rules: make(map[ItemStatus]map[TransitionKind]TransitionRule),
	}
	for _, r := range transitionRules {
		if sm.rules[r.From] == nil {
			sm.rules[r.From] = make(map[TransitionKind]TransitionRule)
		}
		sm.rules[r.From][r.Kind] = r
	}
	return sm
}

func (sm *StateMachine) CanTransition(from ItemStatus, kind TransitionKind) bool {
	fromRules, ok := sm.rules[from]
	if !ok {
		return false
	}
	_, ok = fromRules[kind]
	return ok
}

func (sm *StateMachine) Validate(t Transition) error {
	fromRules, ok := sm.rules[t.From]
	if !ok {
		return fmt.Errorf("no transitions from state %q", t.From)
	}
	rule, ok := fromRules[t.Kind]
	if !ok {
		return fmt.Errorf("transition %q not allowed from state %q", t.Kind, t.From)
	}
	if rule.RequiresEvidence && t.Evidence == "" {
		return fmt.Errorf("transition %q requires evidence", t.Kind)
	}
	if rule.RequiresReason && t.Reason == "" {
		return fmt.Errorf("transition %q requires a reason", t.Kind)
	}
	if t.Actor == "" {
		return fmt.Errorf("transition requires an actor")
	}
	return nil
}

func (sm *StateMachine) Apply(t Transition) (ItemStatus, error) {
	if err := sm.Validate(t); err != nil {
		return t.From, err
	}
	rule := sm.rules[t.From][t.Kind]
	return rule.To, nil
}

func (sm *StateMachine) AvailableTransitions(from ItemStatus) []TransitionRule {
	fromRules, ok := sm.rules[from]
	if !ok {
		return nil
	}
	result := make([]TransitionRule, 0, len(fromRules))
	for _, r := range fromRules {
		result = append(result, r)
	}
	return result
}

type CRStatus string

const (
	CRDraft    CRStatus = "draft"
	CRProposed CRStatus = "proposed"
	CRVoting   CRStatus = "voting"
	CRApproved CRStatus = "approved"
	CRRejected CRStatus = "rejected"
	CRApplied  CRStatus = "applied"
	CRArchived CRStatus = "archived"
)

type CRTransitionKind string

const (
	CRSubmit  CRTransitionKind = "submit"
	CROpen    CRTransitionKind = "open_voting"
	CRApprove CRTransitionKind = "approve"
	CRReject  CRTransitionKind = "reject"
	CRApplyT  CRTransitionKind = "apply"
	CRArchive CRTransitionKind = "archive"
)

type CRTransitionRule struct {
	From CRStatus
	To   CRStatus
	Kind CRTransitionKind
}

var crTransitionRules = []CRTransitionRule{
	{CRDraft, CRProposed, CRSubmit},
	{CRProposed, CRVoting, CROpen},
	{CRVoting, CRApproved, CRApprove},
	{CRVoting, CRRejected, CRReject},
	{CRApproved, CRApplied, CRApplyT},
	{CRApplied, CRArchived, CRArchive},
	{CRRejected, CRArchived, CRArchive},
}

type CRStateMachine struct {
	rules map[CRStatus]map[CRTransitionKind]CRTransitionRule
}

func NewCRStateMachine() *CRStateMachine {
	sm := &CRStateMachine{
		rules: make(map[CRStatus]map[CRTransitionKind]CRTransitionRule),
	}
	for _, r := range crTransitionRules {
		if sm.rules[r.From] == nil {
			sm.rules[r.From] = make(map[CRTransitionKind]CRTransitionRule)
		}
		sm.rules[r.From][r.Kind] = r
	}
	return sm
}

func (sm *CRStateMachine) Apply(from CRStatus, kind CRTransitionKind) (CRStatus, error) {
	fromRules, ok := sm.rules[from]
	if !ok {
		return from, fmt.Errorf("no transitions from CR state %q", from)
	}
	rule, ok := fromRules[kind]
	if !ok {
		return from, fmt.Errorf("CR transition %q not allowed from state %q", kind, from)
	}
	return rule.To, nil
}
