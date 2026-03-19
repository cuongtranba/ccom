package main

import (
	"time"
)

type Vertical string

const (
	VerticalPM      Vertical = "pm"
	VerticalDesign  Vertical = "design"
	VerticalDev     Vertical = "dev"
	VerticalQA      Vertical = "qa"
	VerticalDevOps  Vertical = "devops"
)

type Node struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Vertical  Vertical  `json:"vertical"`
	Project   string    `json:"project"`
	Owner     string    `json:"owner"`
	IsAI      bool      `json:"is_ai"`
	CreatedAt time.Time `json:"created_at"`
}

type ItemKind string

const (
	KindADR        ItemKind = "adr"
	KindAPISpec    ItemKind = "api-spec"
	KindDataModel  ItemKind = "data-model"
	KindTechDesign ItemKind = "tech-design"
	KindEpic       ItemKind = "epic"
	KindUserStory  ItemKind = "user-story"
	KindPRD        ItemKind = "prd"
	KindScreenSpec ItemKind = "screen-spec"
	KindUserFlow   ItemKind = "user-flow"
	KindTestCase   ItemKind = "test-case"
	KindTestPlan   ItemKind = "test-plan"
	KindRunbook    ItemKind = "runbook"
	KindBugReport  ItemKind = "bug-report"
	KindDecision   ItemKind = "decision"
	KindCustom     ItemKind = "custom"
)

type Item struct {
	ID          string     `json:"id"`
	NodeID      string     `json:"node_id"`
	Kind        ItemKind   `json:"kind"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	ExternalRef string     `json:"external_ref,omitempty"`
	Status      ItemStatus `json:"status"`
	Evidence    string     `json:"evidence,omitempty"`
	ConfirmedBy string     `json:"confirmed_by,omitempty"`
	ConfirmedAt *time.Time `json:"confirmed_at,omitempty"`
	Version     int        `json:"version"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type TraceRelation string

const (
	RelationTracedFrom TraceRelation = "traced_from"
	RelationMatchedBy  TraceRelation = "matched_by"
	RelationProvenBy   TraceRelation = "proven_by"
)

type Trace struct {
	ID          string        `json:"id"`
	FromItemID  string        `json:"from_item_id"`
	FromNodeID  string        `json:"from_node_id"`
	ToItemID    string        `json:"to_item_id"`
	ToNodeID    string        `json:"to_node_id"`
	ToPeerID    string        `json:"to_peer_id,omitempty"`
	Relation    TraceRelation `json:"relation"`
	ConfirmedBy string        `json:"confirmed_by,omitempty"`
	ConfirmedAt *time.Time    `json:"confirmed_at,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
}

type SignalKind string

const (
	SignalChange       SignalKind = "change"
	SignalQuery        SignalKind = "query"
	SignalVoteRequest  SignalKind = "vote_request"
	SignalNotification SignalKind = "notification"
)

type Signal struct {
	ID         string     `json:"id"`
	Kind       SignalKind `json:"kind"`
	SourceItem string     `json:"source_item"`
	SourceNode string     `json:"source_node"`
	TargetItem string     `json:"target_item"`
	TargetNode string     `json:"target_node"`
	Payload    string     `json:"payload"`
	Processed  bool       `json:"processed"`
	CreatedAt  time.Time  `json:"created_at"`
}

type ChangeRequest struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	ProposerID  string    `json:"proposer_id"`
	NodeID      string    `json:"node_id"`
	Status      CRStatus  `json:"status"`
	AffectedItems []string `json:"affected_items"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type VoteDecision string

const (
	VoteApprove        VoteDecision = "approve"
	VoteReject         VoteDecision = "reject"
	VoteRequestChanges VoteDecision = "request_changes"
	VoteAbstain        VoteDecision = "abstain"
)

type Vote struct {
	ID        string       `json:"id"`
	CRID      string       `json:"cr_id"`
	NodeID    string       `json:"node_id"`
	VoterID   string       `json:"voter_id"`
	Decision  VoteDecision `json:"decision"`
	Reason    string       `json:"reason"`
	IsAI      bool         `json:"is_ai"`
	CreatedAt time.Time    `json:"created_at"`
}

type Query struct {
	ID         string    `json:"id"`
	AskerID    string    `json:"asker_id"`
	AskerNode  string    `json:"asker_node"`
	Question   string    `json:"question"`
	Context    string    `json:"context"`
	TargetNode string    `json:"target_node,omitempty"`
	Resolved   bool      `json:"resolved"`
	CreatedAt  time.Time `json:"created_at"`
}

type QueryResponse struct {
	ID          string    `json:"id"`
	QueryID     string    `json:"query_id"`
	ResponderID string    `json:"responder_id"`
	NodeID      string    `json:"node_id"`
	Answer      string    `json:"answer"`
	IsAI        bool      `json:"is_ai"`
	CreatedAt   time.Time `json:"created_at"`
}

// ChecklistEntry represents a single criterion attached to an inventory item.
// Each entry tracks whether the criterion is satisfied and the proof for it.
type ChecklistEntry struct {
	ID        string     `json:"id"`
	ItemID    string     `json:"item_id"`
	Criterion string     `json:"criterion"`
	Checked   bool       `json:"checked"`
	Proof     string     `json:"proof"`
	CheckedBy string     `json:"checked_by"`
	CheckedAt *time.Time `json:"checked_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// ChecklistSummary provides a high-level view of an item's checklist status.
// Used in P2P responses — only criterion names cross the wire, not proof details.
type ChecklistSummary struct {
	Total   int      `json:"total"`
	Checked int      `json:"checked"`
	Items   []string `json:"items"`
}

// ItemSummary is the P2P-safe representation of an item with checklist status.
// Full body and proof details stay local; only metadata crosses the wire.
type ItemSummary struct {
	ID        string           `json:"id"`
	NodeID    string           `json:"node_id"`
	Kind      ItemKind         `json:"kind"`
	Title     string           `json:"title"`
	Status    ItemStatus       `json:"status"`
	Checklist ChecklistSummary `json:"checklist"`
}

// ReconciliationSession groups re-verifications after a sweep into auditable sessions.
type ReconciliationSession struct {
	ID          string                `json:"id"`
	TriggerRef  string                `json:"trigger_ref"`
	NodeID      string                `json:"node_id"`
	Status      string                `json:"status"`
	Entries     []ReconciliationEntry `json:"entries,omitempty"`
	StartedBy   string                `json:"started_by"`
	StartedAt   time.Time             `json:"started_at"`
	CompletedAt *time.Time            `json:"completed_at,omitempty"`
}

// ReconciliationEntry records a per-item decision within a reconciliation session.
type ReconciliationEntry struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	ItemID    string    `json:"item_id"`
	Decision  string    `json:"decision"`
	Evidence  string    `json:"evidence"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"created_at"`
}

type PeerStatus string

const (
	PeerStatusPending  PeerStatus = "pending"
	PeerStatusApproved PeerStatus = "approved"
	PeerStatusBlocked  PeerStatus = "blocked"
)

type Peer struct {
	PeerID   string     `json:"peer_id"`
	NodeID   string     `json:"node_id"`
	Name     string     `json:"name"`
	Vertical Vertical   `json:"vertical"`
	Project  string     `json:"project"`
	Owner    string     `json:"owner"`
	IsAI     bool       `json:"is_ai"`
	Status   PeerStatus `json:"status"`
	LastSeen *time.Time `json:"last_seen,omitempty"`
	Addrs    []string   `json:"addrs"`
}

type OutboxMessage struct {
	ID        string    `json:"id"`
	ToPeer    string    `json:"to_peer"`
	Envelope  []byte    `json:"envelope"`
	Attempts  int       `json:"attempts"`
	CreatedAt time.Time `json:"created_at"`
	NextRetry time.Time `json:"next_retry"`
}

// UpstreamVerticals defines which verticals are upstream of a given vertical.
// Used by audit to enforce mandatory upstream references.
var UpstreamVerticals = map[Vertical][]Vertical{
	VerticalDesign: {VerticalPM},
	VerticalDev:    {VerticalPM, VerticalDesign},
	VerticalQA:     {VerticalDev},
	VerticalDevOps: {VerticalDev, VerticalQA},
}

// --- P2P Proposal Types ---

type ProposalKind string

const (
	ProposalCR         ProposalKind = "change_request"
	ProposalTrace      ProposalKind = "trace_dispute"
	ProposalSweep      ProposalKind = "sweep_acceptance"
	ProposalMembership ProposalKind = "network_membership"
	ProposalChallenge  ProposalKind = "challenge"
)

type ProposalStatus string

const (
	ProposalVoting   ProposalStatus = "voting"
	ProposalApproved ProposalStatus = "approved"
	ProposalRejected ProposalStatus = "rejected"
	ProposalExpired  ProposalStatus = "expired"
)

type Proposal struct {
	ID            string         `json:"id"`
	Kind          ProposalKind   `json:"kind"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	ProposerPeer  string         `json:"proposer_peer"`
	ProposerName  string         `json:"proposer_name"`
	OwnerPeer     string         `json:"owner_peer"`
	Status        ProposalStatus `json:"status"`
	AffectedItems []string       `json:"affected_items"`
	Deadline      time.Time      `json:"deadline"`
	CreatedAt     time.Time      `json:"created_at"`
	ResolvedAt    *time.Time     `json:"resolved_at,omitempty"`
}

type ProposalVoteRecord struct {
	ID         string    `json:"id"`
	ProposalID string    `json:"proposal_id"`
	VoterPeer  string    `json:"voter_peer"`
	VoterID    string    `json:"voter_id"`
	Decision   string    `json:"decision"`
	Reason     string    `json:"reason"`
	IsAI       bool      `json:"is_ai"`
	CreatedAt  time.Time `json:"created_at"`
}

type TallyResult struct {
	TotalEligible int            `json:"total_eligible"`
	HumanVotes    int            `json:"human_votes"`
	AIVotes       int            `json:"ai_votes"`
	Approve       int            `json:"approve"`
	Reject        int            `json:"reject"`
	QuorumReached bool           `json:"quorum_reached"`
	Decision      ProposalStatus `json:"decision"`
	OwnerVetoed   bool           `json:"owner_vetoed"`
}

// --- Pairing Session Types ---

type PairingStatus string

const (
	PairingPending PairingStatus = "pending"
	PairingActive  PairingStatus = "active"
	PairingEnded   PairingStatus = "ended"
)

type PairingSession struct {
	ID          string        `json:"id"`
	HostPeerID  string        `json:"host_peer_id"`
	HostNodeID  string        `json:"host_node_id"`
	GuestPeerID string        `json:"guest_peer_id"`
	GuestNodeID string        `json:"guest_node_id"`
	Status      PairingStatus `json:"status"`
	StartedAt   time.Time     `json:"started_at"`
	EndedAt     *time.Time    `json:"ended_at,omitempty"`
}

// --- P2P Challenge Types ---

type ChallengeKind string

const (
	ChallengeStaleData      ChallengeKind = "stale_data"
	ChallengeWeakEvidence   ChallengeKind = "weak_evidence"
	ChallengeTraceIntegrity ChallengeKind = "trace_integrity"
)

type ChallengeStatus string

const (
	ChallengeOpen      ChallengeStatus = "open"
	ChallengeResponded ChallengeStatus = "responded"
	ChallengeVoting    ChallengeStatus = "voting"
	ChallengeSustained ChallengeStatus = "sustained"
	ChallengeDismissed ChallengeStatus = "dismissed"
	ChallengeExpired   ChallengeStatus = "expired"
)

type Challenge struct {
	ID               string          `json:"id"`
	Kind             ChallengeKind   `json:"kind"`
	ChallengerPeer   string          `json:"challenger_peer"`
	ChallengedPeer   string          `json:"challenged_peer"`
	TargetItemID     string          `json:"target_item_id,omitempty"`
	TargetTraceID    string          `json:"target_trace_id,omitempty"`
	Reason           string          `json:"reason"`
	Evidence         string          `json:"evidence,omitempty"`
	ResponseEvidence string          `json:"response_evidence,omitempty"`
	Status           ChallengeStatus `json:"status"`
	Deadline         time.Time       `json:"deadline"`
	CreatedAt        time.Time       `json:"created_at"`
	ResolvedAt       *time.Time      `json:"resolved_at,omitempty"`
}
