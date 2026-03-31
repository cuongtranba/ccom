# P2P Network Design

**Date:** 2026-03-18
**Status:** Approved
**Depends on:** 2026-03-18-phase2-design.md

---

## Context

Each `inv` installation is a fully independent node with its own SQLite database. The Constitution framework requires each vertical (PM, Design, Dev, QA, DevOps) to own their inventory. Data never leaves the owning node unless explicitly requested.

The problem: when user A installs `inv` and user B installs `inv`, they have no way to find each other or exchange signals. This design adds a P2P layer so nodes can communicate without a central server.

## Principles

- **Ownership is sacred** — inventory content (body, evidence, full records) stays in the owning node's SQLite. No replication. Item IDs and metadata (kind, status, title) may cross the wire for trace resolution and coordination.
- **Messages, not sync** — only signals, CRs, queries, and trace resolutions cross the wire.
- **Offline-first** — all commands work locally. P2P extends, never replaces.
- **Store-and-forward** — if a peer is offline, messages queue locally and deliver on reconnect.

## Architecture

```
┌──────────────┐         libp2p streams          ┌──────────────┐
│  PM Node     │◄────────────────────────────────►│  Dev Node    │
│  (Duke)      │   signals, CRs, queries, traces  │  (Cuong)     │
│  inventory.db│                                   │  inventory.db│
└──────┬───────┘                                   └──────┬───────┘
       │              ┌──────────────┐                    │
       └─────────────►│  QA Node     │◄───────────────────┘
                      │  (Blue)      │
                      │  inventory.db│
                      └──────────────┘

Discovery: libp2p DHT (internet-wide) + mDNS (LAN fast-path)
Transport: TCP + noise encryption via libp2p
Protocol: Protobuf over libp2p streams
Offline: store-and-forward (local outbox queue)
Traces: reference by peer ID + item ID, resolve on demand
```

## What Crosses the Wire

| Message type | Direction | Purpose |
|---|---|---|
| `signal.change` | Source → dependent nodes | "My item changed, your dependents may be suspect" |
| `signal.sweep` | Broadcaster → all peers | "External ref X changed" |
| `proposal.create` | Proposer → voting nodes | "Please vote on this proposal" |
| `proposal.vote` | Voter → proposer | "My vote: approve/reject" |
| `query.ask` | Asker → target/broadcast | "I have a question" |
| `query.respond` | Responder → asker | "Here's my answer" |
| `trace.resolve` | Requester → owner | "Give me metadata for item X" |
| `peer.announce` | Node → DHT | "I'm online at this address" |

## Node Identity & Discovery

Each node gets a persistent Ed25519 keypair on first run. The peer ID derived from the public key is the network-wide identifier.

```
~/.inv/
├── identity.key       # libp2p private key (never shared)
├── peer_id            # derived peer ID (e.g., 12D3KooWABC...)
└── inventory.db       # node's own database
```

### Startup flow

```
inv serve --port 9090 --project clinic-checkin
  1. Load or generate identity.key
  2. Create libp2p host (TCP + noise encryption)
  3. Start DHT + mDNS discovery
  4. Announce to DHT with rendezvous: /inv/project/clinic-checkin
  5. Discover peers announcing the same project
  6. Open persistent streams to known peers
  6b. Exchange PeerHandshake with each peer to map peer_id → node metadata
  7. Drain outbox → deliver pending messages
  8. Print startup banner with network info (see below)
  9. Listen for incoming messages
```

### Startup banner

`inv serve` prints a banner on startup so users can easily share their address with teammates:

```
$ inv serve --port 9090

inv — Inventory Network
═══════════════════════════════════════════════════

  Node:      dev-inventory
  Vertical:  dev
  Project:   clinic-checkin
  Owner:     cuong
  AI:        no

  Peer ID:   12D3KooWABC...
  Listening:  /ip4/0.0.0.0/tcp/9090

  Share this address with your team:
  ┌─────────────────────────────────────────────────────────────┐
  │ /ip4/192.168.1.5/tcp/9090/p2p/12D3KooWABC...               │
  └─────────────────────────────────────────────────────────────┘

  Join command:
    inv init --from-peer /ip4/192.168.1.5/tcp/9090/p2p/12D3KooWABC...

═══════════════════════════════════════════════════
  MCP server: stdio (ready for Claude Code)
  mDNS:       enabled (LAN auto-discovery)
  DHT:        enabled (internet-wide discovery)

  Peers:      0 connected
  Outbox:     0 messages queued

Waiting for connections...
```

When peers connect, the banner updates with live status:

```
[12:34:05] Peer connected: pm-inventory (Duke) — 12D3KooWDEF...
[12:34:12] Peer connected: qa-inventory (Blue) — 12D3KooWGHI...
[12:35:00] Peers: 2 connected | Outbox: 0 queued
```

The multiaddr uses the machine's LAN IP via `P2PHost.ShareableAddrs()`, which wraps libp2p's advertised addresses into human-readable multiaddr strings. If multiple interfaces exist, all reachable addresses are listed.

### Peer table (SQLite)

```sql
CREATE TABLE IF NOT EXISTS peers (
    peer_id     TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    vertical    TEXT NOT NULL,
    project     TEXT NOT NULL,
    owner       TEXT NOT NULL,
    is_ai       INTEGER DEFAULT 0,
    last_seen   DATETIME,
    addrs       TEXT DEFAULT '[]'
);
```

Local `nodes` table is unchanged (your own node). `peers` table tracks remote nodes.

## Message Protocol (Protobuf)

**libp2p protocol ID:** `/inv/1.0.0`

```protobuf
syntax = "proto3";
package inv;

import "google/protobuf/timestamp.proto";

message Envelope {
  string message_id = 1;
  string from_peer = 2;
  string to_peer = 3;
  google.protobuf.Timestamp timestamp = 4;

  oneof payload {
    SignalChange signal_change = 10;
    SignalSweep signal_sweep = 11;
    QueryAsk query_ask = 14;
    QueryRespond query_respond = 15;
    TraceResolveRequest trace_resolve_req = 16;
    TraceResolveResponse trace_resolve_resp = 17;
    Ack ack = 20;
    Error error = 21;
  }
}

message SignalChange {
  string source_item_id = 1;
  string source_node_id = 2;
  string target_item_id = 3;
  string reason = 4;
}

message SignalSweep {
  string external_ref = 1;
  string source_node_id = 2;
  repeated string matched_item_ids = 3;
}

message QueryAsk {
  string query_id = 1;
  string asker_id = 2;
  string question = 3;
  string context = 4;
}

message QueryRespond {
  string query_id = 1;
  string responder_id = 2;
  string answer = 3;
  bool is_ai = 4;
}

message TraceResolveRequest {
  string item_id = 1;
}

message TraceResolveResponse {
  string item_id = 1;
  string kind = 2;
  string title = 3;
  string status = 4;
  string node_id = 5;
  string vertical = 6;
  bool found = 7;
}

message Ack {
  string ref_message_id = 1;
}

message Error {
  string ref_message_id = 1;
  string code = 2;
  string message = 3;
}

message PeerHandshake {
  string peer_id = 1;
  string node_id = 2;
  string name = 3;
  string vertical = 4;
  string project = 5;
  string owner = 6;
  bool is_ai = 7;
}
```

### Stream lifecycle

```
Sender                          Receiver
  │                                │
  ├─── open stream (/inv/1.0.0) ──►│
  ├─── write Envelope ────────────►│
  │                                ├── process message
  │◄── write Envelope (Ack/Resp) ──┤
  ├─── close stream ──────────────►│
```

### Store-and-forward outbox

```sql
CREATE TABLE IF NOT EXISTS outbox (
    id          TEXT PRIMARY KEY,
    to_peer     TEXT NOT NULL,
    envelope    BLOB NOT NULL,
    attempts    INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_retry  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

When a peer is unreachable, the serialized envelope is written to `outbox`. On reconnect, the node drains the outbox with exponential backoff.

## CLI Changes

### New commands

```bash
inv serve --port 9090 --project clinic-checkin   # Start P2P node
inv network status                                # Peer ID, connected peers, outbox count
inv network peers                                 # List discovered peers
inv network connect <multiaddr>                   # Manual peer connection
```

### Process Model

`inv serve` is a long-running daemon that runs both the P2P host (libp2p on TCP) and the MCP server (stdio). It is designed to be launched by Claude Code as an MCP server process:

```
claude mcp add --transport stdio --scope project inventory -- inv serve --port 9090
```

Separate `inv <command>` calls in another terminal connect directly to the SQLite database file (`~/.inv/inventory.db`) — they do not need `inv serve` to be running. SQLite WAL mode ensures safe concurrent access between the daemon and CLI commands. The P2P layer is only active when `inv serve` is running.

### Existing commands — P2P extensions

| Command | Change |
|---|---|
| `inv trace add --to <id>` | Accepts `<peer_id>:<item_id>` for cross-node traces. Sends `TraceResolveRequest` to verify remote item exists. Cross-node traces store the remote `peer_id` and `item_id` in the local traces table; the foreign key constraint on `to_item_id` is relaxed (nullable) for remote traces. A `to_peer_id` column is added to the traces table. |
| `inv verify <id>` | After local propagation, sends `SignalChange` to remote peers in the trace graph. |
| `inv sweep --ref X` | Broadcasts `SignalSweep` to all peers. |
| `inv cr submit` | Broadcasts `ProposalCreate` to all peer nodes. Requires draft CR to exist first via `inv cr create`. |
| `inv cr vote` | Sends `CRVote` back to proposer's node. |
| `inv ask` | Sends `QueryAsk` to target peer or broadcasts. |
| `inv impact` | Follows cross-node traces via `TraceResolveRequest`. |

All commands still work offline. P2P extends, never replaces.

### Signal Routing

`PropagateChange` first runs locally (existing behavior). After local propagation, it checks each trace in the graph: if `trace.ToNodeID` matches a remote peer (not the local node), the engine emits a `SignalChange` message to that peer. The sender knows about remote traces because cross-node traces are stored locally when created. Receivers process incoming `SignalChange` by running their own local `PropagateChange` from the target item.

For inbound traces (another node traced TO your item), the remote node stores the trace in their database. When they receive a `SignalChange` targeting their item, they propagate locally through their own trace graph. Your node is not aware of traces created on remote nodes — each node only propagates through traces it knows about. This is consistent with the ownership principle: each node is responsible for propagating through its own trace graph.

## Package Layout

```
my-inventory/
├── main.go              # CLI (existing + serve, network commands)
├── engine.go            # Core domain logic (unchanged)
├── store.go             # SQLite (add peers, outbox tables)
├── network.go           # Domain types (unchanged)
├── state.go             # State machines (unchanged)
├── signal.go            # Propagation (extended for remote signals)
├── graph.go             # DI wiring (add P2P providers)
├── mcp_server.go        # MCP tools (unchanged)
├── p2p.go               # libp2p host, DHT, mDNS setup
├── p2p_handlers.go      # Incoming message handlers
├── p2p_sender.go        # Outgoing messages + outbox queue
├── identity.go          # Keypair management
├── proto/
│   ├── inv.proto        # Protobuf definitions
│   └── inv.pb.go        # Generated code
├── *_test.go            # Existing tests
├── p2p_test.go          # P2P integration tests
└── docs/plans/
```

### New dependencies

| Library | Purpose |
|---|---|
| `github.com/libp2p/go-libp2p` | P2P host, transports, security |
| `github.com/libp2p/go-libp2p-kad-dht` | Kademlia DHT for discovery |
| `google.golang.org/protobuf` | Protobuf runtime + codegen |

### DI additions (graph.go)

```go
var P2PHost    = pumped.Derive2(Config, SystemLog, ...)
var P2PSender  = pumped.Derive3(P2PHost, DBStore, SystemLog, ...)
var P2PHandlers = pumped.Derive3(NetworkEngine, P2PSender, AgentLog, ...)
```

## Voting & Consensus

### Governance Model

Four decision types, one voting mechanism, quorum-based with simple majority (>50% of human nodes).

| Decision Type | Who votes | Quorum | Timeout | Owner veto |
|---|---|---|---|---|
| **Change Request** | All human nodes in project | >50% of human nodes | 24h or quorum-reached | No |
| **Trace dispute** | All human nodes + owning node | >50% of human nodes | 24h or quorum-reached | Owning node reject = auto-reject |
| **Sweep acceptance** | Target node only | 1 (the owner) | 24h (auto-accept on timeout) | Yes (it's their data) |
| **Network membership** | All existing human nodes | >50% of human nodes | 48h or quorum-reached | No |
| **Challenge** | All human nodes (excl. challenger and challenged) | >50% of human nodes | 24h or quorum-reached | No |

### AI Node Rules

- AI nodes can cast votes on any decision type
- AI votes are tagged `is_ai = true` and visible to all voters
- AI votes **do not** count toward quorum
- AI votes **do not** affect the tally outcome
- Purpose: advisory signal (e.g., "I analyzed the trace graph and this CR looks safe")

### Vote Lifecycle

```
proposal created
    │
    ├── votes arrive (human + AI advisory)
    │
    ├── quorum reached? ──yes──► tally → decide (approve/reject)
    │
    └── deadline reached? ──yes──► quorum met? ──yes──► tally → decide
                                              ──no───► expired (must resubmit)
```

### Proposal Type

`Proposal` is a P2P coordination mechanism for cross-boundary decisions. Local CRs (within a single node) continue to use the existing `ChangeRequest` type and `change_requests` table. When a CR involves multiple nodes, it is wrapped in a `Proposal` and broadcast to peers.

```go
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

type TallyResult struct {
    TotalEligible int            `json:"total_eligible"`
    HumanVotes    int            `json:"human_votes"`
    AIVotes       int            `json:"ai_votes"`
    QuorumReached bool           `json:"quorum_reached"`
    Decision      ProposalStatus `json:"decision"`
    OwnerVetoed   bool           `json:"owner_vetoed"`
}

// Engine method
func (e *Engine) TallyProposal(ctx context.Context, proposalID string) (*TallyResult, error)
```

### Decision Type Details

**Change Requests:** Existing CR flow upgraded to Proposal protocol. Broadcasts `ProposalCreate` to all peers. Votes arrive via `ProposalVote`. Tally on quorum or deadline.

**Trace Disputes:** When node A creates a cross-node trace to node B's item, B receives a proposal. Owner veto: if B rejects, auto-rejected regardless of other votes. Other nodes' votes are advisory.

**Sweep Acceptance:** When a sweep broadcast arrives, the receiving node automatically runs a local sweep (finds items matching the `external_ref`, marks dependents suspect). No approval is required for the automatic marking. The 'sweep acceptance' proposal is only triggered if the sweep would affect items with active challenges or items in a reconciliation session — in those cases, the owning node must explicitly approve before the suspect marking is applied.

**Network Membership:** New node announces on DHT → existing nodes detect → auto-creates membership proposal. Before approval, new peer has `status = 'pending'` and can only exchange membership messages. On rejection, peer is blocked.

```sql
ALTER TABLE peers ADD COLUMN status TEXT DEFAULT 'pending';
-- values: pending, approved, blocked
```

```sql
CREATE TABLE IF NOT EXISTS proposals (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT DEFAULT '',
    proposer_peer  TEXT NOT NULL,
    proposer_name  TEXT NOT NULL,
    owner_peer     TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'voting',
    affected_items TEXT DEFAULT '[]',
    deadline       DATETIME NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at    DATETIME
);

CREATE TABLE IF NOT EXISTS proposal_votes (
    id           TEXT PRIMARY KEY,
    proposal_id  TEXT NOT NULL REFERENCES proposals(id),
    voter_peer   TEXT NOT NULL,
    voter_id     TEXT NOT NULL,
    decision     TEXT NOT NULL,
    reason       TEXT DEFAULT '',
    is_ai        INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proposal_id, voter_peer)
);
```

### Consensus Guarantees

**Model:** Eventual consistency with human-in-the-loop. No total ordering. Each node is authority for its own data. Proposals are coordination points.

**Edge cases:**

- **50/50 split:** Rejected (no majority = no consensus to change)
- **Proposer offline before tally:** Any node can request tally via `TallyRequest`. Past deadline, any node computes locally from received votes.
- **Late votes:** Recorded for audit trail, ignored in tally.
- **Node rejoins after offline:** Receives store-and-forwarded proposal + votes. Can still vote if before deadline.
- **Conflicting proposals:** Both proceed independently. If both approved, later resolution triggers reconciliation proposal.
- **Rogue node:** Can only affect own data. Can't forge votes (libp2p peer ID is cryptographic). Existing nodes can propose membership revocation.
- **Membership quorum unreachable:** If a membership proposal expires without quorum (e.g., peers offline), the proposing node may resubmit. After 3 expired attempts, existing online peers can approve with a reduced quorum of >50% of *online* human peers (minimum 1).

### Protobuf Additions

```protobuf
message ProposalCreate {
  string proposal_id = 1;
  string kind = 2;
  string title = 3;
  string description = 4;
  string proposer_peer = 5;
  string owner_peer = 6;
  repeated string affected_item_ids = 7;
  google.protobuf.Timestamp deadline = 8;
}

message ProposalVote {
  string proposal_id = 1;
  string voter_peer = 2;
  string voter_id = 3;
  string decision = 4;
  string reason = 5;
  bool is_ai = 6;
}

message ProposalResult {
  string proposal_id = 1;
  string decision = 2;
  int32 votes_for = 3;
  int32 votes_against = 4;
  int32 total_eligible = 5;
  bool owner_vetoed = 6;
}

message TallyRequest {
  string proposal_id = 1;
}
```

Added to `Envelope.oneof payload`:

```protobuf
ProposalCreate proposal_create = 22;
ProposalVote proposal_vote = 23;
ProposalResult proposal_result = 24;
TallyRequest tally_request = 25;
PeerHandshake peer_handshake = 26;
```

## Node-to-Node Challenge Mechanism

A challenge is a formal demand from one node to another to prove the validity of a claim. Challenges enforce accountability across the network.

### Challenge Types

| Challenge Type | Trigger | What's challenged | Auto-penalty on timeout |
|---|---|---|---|
| **Stale data** | Item marked `proven` but upstream changed with no re-verification | "Prove your item is still valid" | Item → `suspect` |
| **Weak evidence** | Verification evidence appears insufficient | "Show your evidence for this item" | Item → `suspect` |
| **Trace integrity** | Trace relationship appears invalid | "Prove this trace dependency is real" | Trace removed |

### Challenge Lifecycle

```
Challenger                    Challenged Node              All Peers
    │                              │                          │
    ├── ChallengeCreate ──────────►│                          │
    │   (type, item/trace,         │                          │
    │    reason, evidence)         │                          │
    │                              │                          │
    │   ┌── Deadline timer starts ─┤                          │
    │   │                          │                          │
    │   │  Option A: Node responds │                          │
    │   │                          ├── ChallengeResponse ────►│
    │   │                          │   (evidence, justification)
    │   │                          │                          │
    │   │                          │   All peers vote:        │
    │   │                          │   "Is evidence sufficient?"
    │   │                          │                          │
    │   │  ◄── ChallengeResult ────┼──────────────────────────┤
    │   │  (sustained/dismissed)   │                          │
    │   │                          │                          │
    │   │  Option B: No response   │                          │
    │   └── Deadline expires ──────┤                          │
    │      Auto-penalty applied    │                          │
    │      (suspect/trace removed) │                          │
    │   ◄── ChallengeResult ───────┤                          │
    │      (sustained by timeout)  │                          │
```

**States:** `open` → `responded` → `voting` → `sustained` | `dismissed` | `expired`

- **sustained**: Challenge upheld — penalty applied (item → suspect, or trace removed)
- **dismissed**: Evidence accepted by peers — no penalty. Challenger's reputation reduced.
- **expired**: No response by deadline — auto-penalty applied without vote.

### Anti-Spam: Cooldown + Reputation

**Cooldown:** Each node can only challenge the same target node once per 24h window. Prevents burst spam.

**Reputation scoring:**

| Outcome | Challenger | Challenged |
|---|---|---|
| Sustained | +1 | -1 |
| Dismissed | -1 | 0 |
| Expired (no response) | +1 | -2 |

- Score floor: -10. At -10, challenges from that node are auto-rejected (peers can still accept manually).
- Recovery: sustained challenges or receiving positive votes restores reputation.

**Note:** Reputation is a local view. Each node computes scores from challenge outcomes it has witnessed. Nodes that were offline during a challenge resolution may have different scores for the same peer. Reputation is not gossiped — each node is authoritative for its own scoring.

### Data Model

```go
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
```

### SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS challenges (
    id                TEXT PRIMARY KEY,
    kind              TEXT NOT NULL,
    challenger_peer   TEXT NOT NULL,
    challenged_peer   TEXT NOT NULL,
    target_item_id    TEXT,
    target_trace_id   TEXT,
    reason            TEXT NOT NULL,
    evidence          TEXT DEFAULT '',
    response_evidence TEXT DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'open',
    deadline          DATETIME NOT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at       DATETIME
);

CREATE TABLE IF NOT EXISTS peer_reputation (
    peer_id    TEXT PRIMARY KEY,
    score      INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS challenge_cooldowns (
    challenger_peer TEXT NOT NULL,
    challenged_peer TEXT NOT NULL,
    last_challenge  DATETIME NOT NULL,
    PRIMARY KEY (challenger_peer, challenged_peer)
);
```

### Protobuf Additions

```protobuf
message ChallengeCreate {
    string challenge_id = 1;
    string kind = 2;
    string challenger_peer = 3;
    string challenged_peer = 4;
    string target_item_id = 5;
    string target_trace_id = 6;
    string reason = 7;
    string evidence = 8;
    int64 deadline_seconds = 9;  // relative duration in seconds; receiver computes absolute deadline on receipt
}

message ChallengeResponse {
    string challenge_id = 1;
    string evidence = 2;
    string justification = 3;
}

message ChallengeVote {
    string challenge_id = 1;
    string voter_peer = 2;
    string decision = 3;  // "sustain" or "dismiss"
    string reason = 4;
    bool is_ai = 5;
}

message ChallengeResult {
    string challenge_id = 1;
    string outcome = 2;  // "sustained", "dismissed", "expired"
    int32 votes_sustain = 3;
    int32 votes_dismiss = 4;
    string penalty_applied = 5;
}
```

Added to `Envelope.oneof payload`:

```protobuf
ChallengeCreate challenge_create = 30;
ChallengeResponse challenge_response = 31;
ChallengeVote challenge_vote = 32;
ChallengeResult challenge_result = 33;
```

### CLI Commands

```bash
# Challenge a node's item (stale data or weak evidence)
inv challenge item <item-id> --peer <peer-id> --kind stale_data --reason "Upstream changed, no re-verification"

# Challenge a trace relationship
inv challenge trace <trace-id> --peer <peer-id> --reason "This trace dependency is invalid"

# Respond to a challenge against your node
inv challenge respond <challenge-id> --evidence "Re-verified against latest spec, see commit abc123"

# Vote on an active challenge
inv challenge vote <challenge-id> --decision sustain --reason "Evidence is outdated"
inv challenge vote <challenge-id> --decision dismiss --reason "Evidence is sufficient"

# List challenges
inv challenge list                    # All active challenges
inv challenge list --incoming         # Challenges against your node
inv challenge list --outgoing         # Challenges you filed

# Check reputation
inv network reputation                # Your score
inv network reputation --peer <id>    # Another peer's score
```

### Integration with Existing Commands

| Existing command | Challenge integration |
|---|---|
| `inv audit <node-id>` | Includes: active challenges, reputation score, items under challenge |
| `inv network status` | Shows reputation score alongside peer info |
| `inv network peers` | Displays each peer's reputation score |
| `inv verify <item-id>` | If item is under active challenge, auto-responds with new evidence |
| `inv impact <item-id>` | Flags items currently under challenge in the impact tree |

### Auto-Challenge

When `inv serve` is running with auto-challenge enabled, the node automatically files `stale_data` challenges when upstream items propagate signals and downstream nodes don't re-verify within a configurable threshold.

```bash
inv serve --auto-challenge    # Enable automatic challenges
```

Configuration (`~/.inv/config.yaml`):

```yaml
challenges:
  auto_challenge: true
  stale_threshold: 48h
  cooldown: 24h
```

### Edge Cases

- **Challenge during offline:** Stored in outbox, delivered on reconnect. Deadline is a relative duration — receiver computes absolute deadline on receipt.
- **Counter-challenge:** Challenged node can file a counter-challenge. Both proceed independently. Cooldown applies per direction.
- **Challenge against pending peer:** Not allowed. Only `approved` peers can participate in challenges.
- **Self-challenge:** Not allowed. Validator rejects `challenger_peer == challenged_peer`.
- **Challenge on already-suspect item:** `stale_data` auto-dismissed (penalty already applied). `weak_evidence` allowed (evidence quality is separate from status).
- **Multiple active challenges on same item:** Allowed from different challengers, resolved independently.
- **Reputation floor:** Score cannot go below -10. At -10, node's challenges are auto-rejected.

## Security & Threat Model

### Threat Landscape

| Threat | Vector | Impact |
|---|---|---|
| **Message tampering** | MITM alters envelope in transit | False signals, forged votes, corrupted traces |
| **Replay attack** | Attacker re-sends a valid old message | Duplicate votes, re-triggered signals, stale challenges |
| **Sybil attack** | Attacker creates many fake nodes to gain voting majority | Governance manipulation, false quorum |
| **Impersonation** | Attacker pretends to be a known peer | Forge votes, steal data via trace resolution |
| **Eavesdropping** | Attacker listens to P2P traffic | Learns inventory structure, item status, business decisions |
| **Denial of service** | Flood a node with messages/challenges | Node overwhelmed, can't process real work |
| **Rogue approved node** | Legitimately approved node acts maliciously | Spam challenges, false votes, garbage proposals |
| **Data exfiltration via queries** | Node sends excessive `trace.resolve` or `query.ask` | Maps another node's entire inventory |

### Mitigations

| Threat | Mitigation | How |
|---|---|---|
| **Message tampering** | libp2p noise encryption | All streams use Noise protocol (authenticated encryption). Peer ID derived from Ed25519 key — sender identity cryptographically verified. |
| **Replay attack** | Message ID + nonce + timestamp window | Every `Envelope.message_id` is a UUID. Receiving node maintains a seen-message LRU cache (10K entries). Messages older than 5 minutes rejected. |
| **Sybil attack** | Network membership governance | New nodes require majority approval from existing human nodes (48h voting). Pending peers cannot vote or file challenges. |
| **Impersonation** | libp2p peer ID = public key | Peer ID derived from Ed25519 public key. libp2p authenticates every connection. Cannot impersonate without private key. |
| **Eavesdropping** | Noise encryption (default) | All libp2p streams encrypted. No plaintext traffic. DHT queries reveal peer presence but not message content. |
| **Denial of service** | Rate limiting + message size cap | Per-peer rate limit: max 100 messages/minute. Max envelope size: 1MB. Exceeded → stream closed, peer throttled (5 min backoff). |
| **Rogue approved node** | Reputation + membership revocation | Reputation system tracks bad behavior. At -10, challenges auto-rejected. Any node can propose membership revocation. |
| **Data exfiltration** | Query rate limit + audit trail | Max 10 `trace.resolve` per peer per hour. All queries logged. Node owner reviews patterns via `inv audit`. |

### Security Data Model

**Seen-message cache (in-memory, bounded):**

```go
type MessageCache struct {
    mu      sync.RWMutex
    seen    map[string]time.Time // message_id → received_at
    maxSize int                  // default 10000
    maxAge  time.Duration        // default 5 minutes
}
```

No SQLite table needed — ephemeral, rebuilt on restart. Old messages replayed after restart rejected by timestamp window.

**Rate limiter (per-peer, in-memory):**

```go
type PeerRateLimiter struct {
    mu       sync.RWMutex
    counters map[string]*RateCounter // peer_id → counter
}

type RateCounter struct {
    Messages    int
    Queries     int
    WindowStart time.Time
    Throttled   bool
    ThrottleEnd time.Time
}
```

**Peer blocklist (SQLite, persistent):**

```sql
CREATE TABLE IF NOT EXISTS peer_blocklist (
    peer_id     TEXT PRIMARY KEY,
    reason      TEXT NOT NULL,
    blocked_by  TEXT NOT NULL,
    blocked_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Blocked peers: connections refused at libp2p level. Blocks survive restart.

## Monitoring & Observability

### What to Monitor

| Layer | What to monitor | Why |
|---|---|---|
| **Node health** | Uptime, connected peers, outbox depth, memory/goroutines | Know if your node is running well |
| **Network activity** | Messages sent/received, latency, peer churn (joins/leaves) | Understand network behavior |
| **Governance activity** | Active proposals, challenges, votes pending, reputation changes | Track decision-making health |

### Metrics (structured zerolog events on stderr)

```go
// Node health — emitted every 30s
systemLog.Info().
    Str("event", "node.health").
    Int("connected_peers", 3).
    Int("outbox_depth", 12).
    Int("goroutines", 47).
    Dur("uptime", time.Since(startTime)).
    Msg("health check")

// Message activity — emitted per message
systemLog.Info().
    Str("event", "p2p.message").
    Str("direction", "outbound").
    Str("type", "signal.change").
    Str("peer", "12D3KooWABC...").
    Dur("latency", elapsed).
    Msg("message exchanged")

// Governance — emitted on state changes
systemLog.Info().
    Str("event", "governance.proposal").
    Str("proposal_id", "prop-123").
    Str("kind", "challenge").
    Str("status", "voting").
    Int("votes_received", 2).
    Int("votes_needed", 3).
    Msg("proposal state change")
```

### `inv network status` (enhanced)

```
$ inv network status

Node:        dev-inventory (12D3KooWABC...)
Project:     clinic-checkin
Uptime:      2h 15m
Status:      online

Peers:       3 connected, 1 pending
  ├── pm-inventory   (12D3KooWDEF...)  online   rep: +3
  ├── qa-inventory   (12D3KooWGHI...)  online   rep: +1
  ├── design-inv     (12D3KooWJKL...)  offline  rep: 0   (last seen: 45m ago)
  └── new-node       (12D3KooWMNO...)  pending

Outbox:      2 messages queued (oldest: 45m)
  └── design-inv: 2 envelopes waiting

Governance:  1 proposal voting, 1 challenge open
  ├── [proposal] "Switch to WebSocket" — 2/3 votes, 18h remaining
  └── [challenge] stale_data on item-456 — awaiting response, 20h remaining

Reputation:  +2
Rate limits: 0 peers throttled

Messages (last 1h):
  Sent:     45    Received: 52
  Errors:   1     (timeout to design-inv)
```

### `inv network health` (machine-readable)

```bash
inv network health          # JSON output for scripts/monitoring
inv network health --watch  # Continuous output every 30s
```

```json
{
  "peer_id": "12D3KooWABC...",
  "uptime_seconds": 8100,
  "connected_peers": 3,
  "pending_peers": 1,
  "outbox_depth": 2,
  "active_proposals": 1,
  "active_challenges": 1,
  "reputation": 2,
  "throttled_peers": 0,
  "messages_sent_1h": 45,
  "messages_received_1h": 52,
  "message_errors_1h": 1
}
```

### Alert Events (zerolog, stderr)

| Alert | Condition | Level |
|---|---|---|
| `alert.outbox_backlog` | Outbox depth > 50 | Warn |
| `alert.peer_lost` | Previously connected peer unreachable > 10 min | Warn |
| `alert.reputation_low` | Local reputation drops below -5 | Error |
| `alert.challenge_deadline` | Challenge against your node < 2h remaining, no response | Error |
| `alert.proposal_deadline` | Proposal you haven't voted on < 2h remaining | Warn |
| `alert.rate_limited` | A peer was throttled for exceeding rate limits | Info |
| `alert.membership_pending` | New peer awaiting approval > 24h | Warn |

## Configuration & Deployment

### Node Configuration (`~/.inv/config.yaml`)

```yaml
# ─────────────────────────────────────────────────
# NODE IDENTITY
# Set during `inv init`. Defines who this node is.
# ─────────────────────────────────────────────────
node:
  name: dev-inventory           # Human-friendly label for this inventory (e.g., "dev-inventory", "claude-qa-agent")
  vertical: dev                 # Team role: pm | design | dev | qa | devops — determines what item kinds belong here
  project: clinic-checkin       # Project name — only nodes with the same project discover each other on the network
  owner: cuong                  # Person or AI agent responsible for this node — used in audit trails, votes, notifications
  is_ai: false                  # true = AI agent node (votes are advisory-only, don't count toward quorum)
  permission_mode: normal       # normal = AI suggests, human confirms everything
                                # autonomous = AI acts freely on own node, only governance requires human confirmation

# ─────────────────────────────────────────────────
# DATABASE
# Where inventory data is stored.
# ─────────────────────────────────────────────────
database:
  path: ~/.inv/inventory.db     # SQLite database file path. WAL mode enabled for concurrent access between
                                # `inv serve` (daemon) and `inv <command>` (CLI) running in separate terminals.

# ─────────────────────────────────────────────────
# P2P NETWORKING
# How this node connects to other nodes.
# ─────────────────────────────────────────────────
network:
  listen_port: 9090             # TCP port for incoming P2P connections. Each node needs a unique port on the same machine.
  bootstrap_peers: []           # List of multiaddrs to connect to on startup (e.g., ["/ip4/192.168.1.5/tcp/9090/p2p/12D3KooW..."]).
                                # Empty = rely on mDNS (LAN) or DHT (internet) to discover peers.
                                # Useful for: remote teams, cloud nodes, or when mDNS doesn't work across subnets.
  enable_mdns: true             # mDNS broadcasts on the local network to auto-discover peers on the same LAN/VPN.
                                # Zero-config for co-located teams. Disable if not needed or causing network noise.
  enable_dht: true              # Kademlia DHT for internet-wide peer discovery via rendezvous key /inv/project/{project}.
                                # Peers don't need to know each other's IP — they find each other through the DHT.
                                # Disable if all peers are on LAN (mDNS is faster and sufficient).

# ─────────────────────────────────────────────────
# SECURITY
# Rate limits, replay protection, and membership rules.
# ─────────────────────────────────────────────────
security:
  max_message_rate: 100         # Max messages per minute from a single peer before throttling.
                                # Prevents DoS — a rogue node flooding your inbox.
  max_envelope_size: 1048576    # Max protobuf envelope size in bytes (default 1MB).
                                # Messages exceeding this are rejected and the stream is closed.
  replay_window: 5m             # Time window for replay attack protection. Messages with timestamps
                                # older than this are rejected. Combined with seen-message cache (by message_id).
  seen_cache_size: 10000        # LRU cache size for deduplicating messages by message_id.
                                # In-memory, rebuilt on restart. Old replayed messages are caught by replay_window.
  query_rate_limit: 10          # Max trace.resolve requests per peer per hour.
                                # Prevents data exfiltration — a node mapping your entire inventory via repeated queries.
  throttle_duration: 5m         # How long a throttled peer is blocked after exceeding max_message_rate.
                                # During throttle, all messages from that peer are dropped.
  membership:
    require_approval: true      # true = new nodes must be approved by existing human nodes via governance vote.
                                # false = any node can join immediately (use only for testing/development).
    approval_timeout: 48h       # How long existing peers have to vote on a membership proposal before it expires.
                                # After 3 expired attempts, quorum is reduced to >50% of online peers (min 1).

# ─────────────────────────────────────────────────
# CHALLENGES
# Node-to-node accountability mechanism.
# ─────────────────────────────────────────────────
challenges:
  auto_challenge: false         # true = node automatically files stale_data challenges when upstream items
                                # propagate signals and downstream nodes don't re-verify within stale_threshold.
                                # Only runs when `inv serve` is active. Recommended for AI agent nodes.
  stale_threshold: 48h          # How long after a signal before auto-challenge considers an item stale.
                                # Only used when auto_challenge is true.
                                # Example: upstream item changed Monday, downstream not re-verified by Wednesday → auto-challenge.
  cooldown: 24h                 # Minimum time between challenges from this node to the same target node.
                                # Prevents burst spam. Tracked per (challenger, target) pair.

# ─────────────────────────────────────────────────
# LOGGING
# Dual zerolog output: agent (stdout) + system (stderr).
# ─────────────────────────────────────────────────
logging:
  agent_level: info             # Agent logger (stdout) — structured JSON for AI agents and scripts to parse.
                                # Used by Claude Code to read inventory events.
                                # Levels: debug, info, warn, error, fatal
  system_level: info            # System logger (stderr) — diagnostics for human operators.
                                # P2P connection events, health checks, errors.
                                # Levels: debug, info, warn, error, fatal

# ─────────────────────────────────────────────────
# OBSERVABILITY
# Health monitoring and alert thresholds.
# ─────────────────────────────────────────────────
observability:
  health_interval: 30s          # How often `inv serve` emits a health check event to stderr.
                                # Includes: connected peers, outbox depth, goroutines, uptime.
                                # Set to 0 to disable health check emitter.
  alert_outbox_threshold: 50    # Warn when outbox has more than this many queued messages.
                                # High outbox = peers are offline and messages are piling up.
  alert_reputation_threshold: -5  # Error when your local reputation score drops below this.
                                  # At -10, your challenges are auto-rejected by other peers.
                                  # A low score means your challenges keep getting dismissed.
  alert_deadline_warning: 2h    # Warn when a challenge against your node or a proposal you haven't voted on
                                # has less than this time remaining before deadline.
                                # Gives you time to respond before auto-penalty or expiration.
```

### File Layout

```
~/.inv/
├── config.yaml          # Node configuration
├── identity.key         # Ed25519 private key (chmod 600)
├── peer_id              # Derived peer ID (human-readable)
├── inventory.db         # SQLite database
└── logs/                # Optional: file-based log output
    ├── agent.log        # Agent log (rotated)
    └── system.log       # System log (rotated)
```

### `inv init` — First-Time Setup

```bash
$ inv init

Welcome to inv — Inventory Network

Node name: dev-inventory
Vertical (pm/design/dev/qa/devops): dev
Project: clinic-checkin
Owner: cuong
AI node? (y/N): N

Generating Ed25519 keypair...
  Peer ID: 12D3KooWABC...
  Key saved: ~/.inv/identity.key (chmod 600)

Creating database: ~/.inv/inventory.db
Writing config: ~/.inv/config.yaml

Done! Your node is ready.

Next steps:
  inv serve                          # Start P2P node
  inv node add --name dev-inventory  # Register your first node
  inv network peers                  # See who's online
```

### `inv init --from-peer <multiaddr>` — Join Existing Network

```bash
$ inv init --from-peer /ip4/192.168.1.5/tcp/9090/p2p/12D3KooWDEF...

Connecting to existing network...
  Found project: clinic-checkin (3 active peers)

Node name: qa-inventory
Vertical (pm/design/dev/qa/devops): qa
Owner: blue

Generating Ed25519 keypair...
  Peer ID: 12D3KooWXYZ...

Requesting network membership...
  Status: pending (awaiting approval from existing peers)

Config written: ~/.inv/config.yaml
Start with: inv serve
```

### Deployment Patterns

**Pattern 1: Developer workstation (most common)**

Each team member runs `inv` locally. LAN discovery via mDNS finds teammates automatically.

```bash
# Terminal 1: Start the node
inv serve

# Terminal 2: Use CLI normally
inv item add --node <id> --kind adr --title "WebSocket design"
```

Best for: co-located teams, same office/VPN. Zero infrastructure.

**Pattern 2: Always-on server node (systemd)**

```ini
# /etc/systemd/system/inv.service
[Unit]
Description=inv Inventory Network Node
After=network.target

[Service]
Type=simple
User=inv
ExecStart=/usr/local/bin/inv serve
Restart=always
RestartSec=5
WorkingDirectory=/home/inv
Environment=HOME=/home/inv

[Install]
WantedBy=multi-user.target
```

Best for: AI agent nodes, CI integration, teams across time zones.

**Pattern 3: Docker container**

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=1 go build -o inv .

FROM alpine:latest
RUN apk add --no-cache sqlite-libs
COPY --from=builder /app/inv /usr/local/bin/inv
VOLUME /data
ENTRYPOINT ["inv", "serve"]
```

```bash
docker run -d --name inv-node -p 9090:9090 -v inv-data:/data -e HOME=/data inv:latest
```

Best for: standardized team deployments, cloud VMs.

**Pattern 4: AI agent node**

```yaml
# config.yaml for AI node
node:
  name: claude-dev-agent
  vertical: dev
  project: clinic-checkin
  owner: claude
  is_ai: true

challenges:
  auto_challenge: true
  stale_threshold: 24h
```

AI agent uses MCP tools to manage its inventory. `is_ai: true` ensures votes are advisory-only.

## Implementation Order

1. **Identity** — keypair generation, storage in `~/.inv/`, peer ID derivation
2. **Config** — YAML config parsing, defaults, `inv init` command
3. **Protobuf** — define `.proto` with all message types (governance + challenges)
4. **P2P host** — libp2p host setup, TCP + noise, DHT + mDNS
5. **Security layer** — message cache, rate limiter, blocklist
6. **Peers table** — SQLite schema with `status` column, CRUD
7. **Outbox** — SQLite schema, queue/drain logic
8. **Proposals table** — SQLite schema, replaces standalone `change_requests` for P2P decisions
9. **Tally engine** — quorum calculation, owner veto, deadline checks, AI vote filtering
10. **Message handlers** — dispatch incoming envelopes to engine methods
11. **Sender** — send envelopes to peers, fallback to outbox
12. **CLI: serve** — `inv serve` command wiring everything together
13. **CLI: network** — `inv network status/peers/connect/health/reputation`
14. **CLI: proposal** — `inv proposal create/vote/status` (unified for all decision types)
15. **Extend existing commands** — trace, verify, sweep with P2P + governance awareness
16. **Challenge tables** — SQLite schema (challenges, peer_reputation, challenge_cooldowns)
17. **Challenge engine** — create, respond, vote, resolve, auto-penalty, reputation updates
18. **Challenge handlers** — incoming message dispatch for challenge protocol
19. **CLI: challenge** — `inv challenge item/trace/respond/vote/list`
20. **Auto-challenge** — stale detection timer, configurable thresholds
21. **Challenge integration** — audit, network status, verify auto-response
22. **Observability** — health check emitter, alert events, `inv network health`
23. **Tests** — P2P integration + governance + challenge + security scenario tests
