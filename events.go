package main

import "time"

// EventKind identifies the type of event that occurred in the inventory network.
type EventKind string

const (
	EventChallengeReceived EventKind = "governance.challenge_received"
	EventVoteRequested     EventKind = "governance.vote_requested"
	EventProposalResult    EventKind = "governance.proposal_result"
	EventChallengeResult   EventKind = "governance.challenge_result"
	EventMembershipRequest EventKind = "governance.membership_request"
	EventPeerJoined        EventKind = "network.peer_joined"
	EventPeerLost          EventKind = "network.peer_lost"
	EventSignalReceived    EventKind = "network.signal_received"
	EventQueryReceived     EventKind = "network.query_received"
	EventSweepReceived     EventKind = "network.sweep_received"
)

var urgentEvents = map[EventKind]bool{
	EventChallengeReceived: true,
	EventVoteRequested:     true,
	EventMembershipRequest: true,
	EventSignalReceived:    true,
}

// IsUrgentEvent returns true if the given event kind requires immediate attention.
func IsUrgentEvent(kind EventKind) bool {
	return urgentEvents[kind]
}

// NodeEvent represents an event that occurred in the inventory network.
type NodeEvent struct {
	Kind      EventKind    `json:"kind"`
	Timestamp time.Time    `json:"timestamp"`
	Urgent    bool         `json:"urgent"`
	Payload   EventPayload `json:"payload"`
}

// EventPayload holds the event-specific data. Exactly one field is non-nil.
type EventPayload struct {
	Challenge  *ChallengeEventData  `json:"challenge,omitempty"`
	Proposal   *ProposalEventData   `json:"proposal,omitempty"`
	Membership *MembershipEventData `json:"membership,omitempty"`
	Peer       *PeerEventData       `json:"peer,omitempty"`
	Signal     *SignalEventData     `json:"signal,omitempty"`
	Query      *QueryEventData      `json:"query,omitempty"`
	Sweep      *SweepEventData      `json:"sweep,omitempty"`
}

// ChallengeEventData carries challenge-related event details.
type ChallengeEventData struct {
	ChallengeID string    `json:"challenge_id"`
	Kind        string    `json:"kind"`
	FromPeer    string    `json:"from_peer"`
	TargetItem  string    `json:"target_item"`
	Reason      string    `json:"reason"`
	Deadline    time.Time `json:"deadline"`
	Outcome     string    `json:"outcome,omitempty"`
	Penalty     string    `json:"penalty,omitempty"`
}

// ProposalEventData carries proposal-related event details.
type ProposalEventData struct {
	ProposalID   string `json:"proposal_id"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Deadline     string `json:"deadline,omitempty"`
	Decision     string `json:"decision,omitempty"`
	VotesFor     int    `json:"votes_for,omitempty"`
	VotesAgainst int    `json:"votes_against,omitempty"`
}

// MembershipEventData carries membership request event details.
type MembershipEventData struct {
	PeerID   string `json:"peer_id"`
	Name     string `json:"name"`
	Vertical string `json:"vertical"`
}

// PeerEventData carries peer join/leave event details.
type PeerEventData struct {
	PeerID   string `json:"peer_id"`
	Name     string `json:"name"`
	LastSeen string `json:"last_seen,omitempty"`
}

// SignalEventData carries signal propagation event details.
type SignalEventData struct {
	ItemID     string `json:"item_id"`
	SourceItem string `json:"source_item"`
	Reason     string `json:"reason"`
}

// QueryEventData carries network query event details.
type QueryEventData struct {
	QueryID  string `json:"query_id"`
	Question string `json:"question"`
	Asker    string `json:"asker"`
}

// SweepEventData carries sweep event details.
type SweepEventData struct {
	ExternalRef  string   `json:"external_ref"`
	MatchedItems []string `json:"matched_items"`
}

// StoredEvent is the persisted form of a NodeEvent in the events table.
type StoredEvent struct {
	ID        string    `json:"id"`
	Kind      EventKind `json:"kind"`
	Payload   string    `json:"payload"`
	Urgent    bool      `json:"urgent"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"created_at"`
}
