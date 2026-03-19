package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

// --- Item State Machine Suite ---

type StateMachineSuite struct {
	suite.Suite
	sm *StateMachine
}

func (s *StateMachineSuite) SetupTest() {
	s.sm = NewStateMachine()
}

func (s *StateMachineSuite) transition(kind TransitionKind, from ItemStatus, evidence, reason string) (ItemStatus, error) {
	return s.sm.Apply(Transition{
		Kind:      kind,
		From:      from,
		Evidence:  evidence,
		Reason:    reason,
		Actor:     "tester",
		Timestamp: time.Now(),
	})
}

func (s *StateMachineSuite) TestVerifyFromUnverified() {
	got, err := s.transition(TransitionVerify, StatusUnverified, "test passed", "")
	s.Require().NoError(err)
	s.Equal(StatusProven, got)
}

func (s *StateMachineSuite) TestSuspectFromProven() {
	got, err := s.transition(TransitionSuspect, StatusProven, "", "upstream changed")
	s.Require().NoError(err)
	s.Equal(StatusSuspect, got)
}

func (s *StateMachineSuite) TestReVerifyFromSuspect() {
	got, err := s.transition(TransitionReVerify, StatusSuspect, "re-tested", "still valid")
	s.Require().NoError(err)
	s.Equal(StatusProven, got)
}

func (s *StateMachineSuite) TestBreakFromSuspect() {
	got, err := s.transition(TransitionBreak, StatusSuspect, "", "confirmed broken")
	s.Require().NoError(err)
	s.Equal(StatusBroke, got)
}

func (s *StateMachineSuite) TestFixFromBroke() {
	got, err := s.transition(TransitionFix, StatusBroke, "fixed and tested", "bug resolved")
	s.Require().NoError(err)
	s.Equal(StatusProven, got)
}

func (s *StateMachineSuite) TestInvalidTransitions() {
	tests := []struct {
		name string
		from ItemStatus
		kind TransitionKind
	}{
		{"unverified cannot break", StatusUnverified, TransitionBreak},
		{"proven cannot verify again", StatusProven, TransitionVerify},
		{"broke cannot become suspect", StatusBroke, TransitionSuspect},
		{"unverified cannot re-verify", StatusUnverified, TransitionReVerify},
		{"proven cannot fix", StatusProven, TransitionFix},
	}
	for _, tt := range tests {
		s.Run(tt.name, func() {
			_, err := s.transition(tt.kind, tt.from, "evidence", "reason")
			s.Error(err)
		})
	}
}

func (s *StateMachineSuite) TestVerifyRequiresEvidence() {
	_, err := s.transition(TransitionVerify, StatusUnverified, "", "")
	s.Error(err)
	s.Contains(err.Error(), "requires evidence")
}

func (s *StateMachineSuite) TestReVerifyRequiresEvidenceAndReason() {
	_, err := s.transition(TransitionReVerify, StatusSuspect, "", "reason")
	s.Error(err)
	s.Contains(err.Error(), "requires evidence")

	_, err = s.transition(TransitionReVerify, StatusSuspect, "evidence", "")
	s.Error(err)
	s.Contains(err.Error(), "requires a reason")
}

func (s *StateMachineSuite) TestRequiresActor() {
	_, err := s.sm.Apply(Transition{
		Kind:      TransitionVerify,
		From:      StatusUnverified,
		Evidence:  "proof",
		Actor:     "",
		Timestamp: time.Now(),
	})
	s.Error(err)
	s.Contains(err.Error(), "requires an actor")
}

func (s *StateMachineSuite) TestAvailableTransitions() {
	rules := s.sm.AvailableTransitions(StatusSuspect)
	s.Len(rules, 2) // re_verify and break

	kinds := make(map[TransitionKind]bool)
	for _, r := range rules {
		kinds[r.Kind] = true
	}
	s.True(kinds[TransitionReVerify])
	s.True(kinds[TransitionBreak])
}

func (s *StateMachineSuite) TestCanTransition() {
	s.True(s.sm.CanTransition(StatusUnverified, TransitionVerify))
	s.False(s.sm.CanTransition(StatusUnverified, TransitionBreak))
	s.True(s.sm.CanTransition(StatusProven, TransitionSuspect))
	s.False(s.sm.CanTransition(StatusProven, TransitionVerify))
}

func TestStateMachineSuite(t *testing.T) {
	suite.Run(t, new(StateMachineSuite))
}

// --- CR State Machine Suite ---

type CRStateMachineSuite struct {
	suite.Suite
	sm *CRStateMachine
}

func (s *CRStateMachineSuite) SetupTest() {
	s.sm = NewCRStateMachine()
}

func (s *CRStateMachineSuite) TestFullApprovalLifecycle() {
	steps := []struct {
		from CRStatus
		kind CRTransitionKind
		want CRStatus
	}{
		{CRDraft, CRSubmit, CRProposed},
		{CRProposed, CROpen, CRVoting},
		{CRVoting, CRApprove, CRApproved},
		{CRApproved, CRApplyT, CRApplied},
		{CRApplied, CRArchive, CRArchived},
	}

	current := CRDraft
	for _, step := range steps {
		s.Require().Equal(step.from, current)
		got, err := s.sm.Apply(current, step.kind)
		s.Require().NoError(err, "step %s->%s", step.from, step.want)
		s.Equal(step.want, got)
		current = got
	}
}

func (s *CRStateMachineSuite) TestRejectPath() {
	got, err := s.sm.Apply(CRVoting, CRReject)
	s.Require().NoError(err)
	s.Equal(CRRejected, got)

	got, err = s.sm.Apply(CRRejected, CRArchive)
	s.Require().NoError(err)
	s.Equal(CRArchived, got)
}

func (s *CRStateMachineSuite) TestInvalidTransitions() {
	tests := []struct {
		name string
		from CRStatus
		kind CRTransitionKind
	}{
		{"draft cannot approve", CRDraft, CRApprove},
		{"draft cannot reject", CRDraft, CRReject},
		{"proposed cannot approve", CRProposed, CRApprove},
		{"approved cannot reject", CRApproved, CRReject},
		{"archived cannot do anything", CRArchived, CRSubmit},
	}
	for _, tt := range tests {
		s.Run(tt.name, func() {
			_, err := s.sm.Apply(tt.from, tt.kind)
			s.Error(err)
		})
	}
}

func TestCRStateMachineSuite(t *testing.T) {
	suite.Run(t, new(CRStateMachineSuite))
}
