# V1 Bug Fixes + Proposals & Voting — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Fix 5 critical V1 bugs, then add proposals + voting system (ported from Go with modified AI vote weighting)

## Part 1: V1 Critical Bug Fixes

### Fix 1: Server — Enforce projectId/fromNode on incoming messages

**Problem:** A client can spoof `envelope.fromNode` and `envelope.projectId`, injecting messages into other projects or impersonating nodes.

**Solution:** In `packages/server/src/index.ts`, the `websocket.message` handler must overwrite envelope fields with authenticated session data before routing:

```typescript
// After parsing envelope
envelope.projectId = ws.data.projectId;
envelope.fromNode = ws.data.nodeId;
```

### Fix 2: Server — Atomic outbox drain

**Problem:** `outbox.drain()` uses `LRANGE` + `DEL` which is not atomic. Between the two commands, a new message could be enqueued and then deleted without being read.

**Solution:** Replace with `RENAME` pattern in `packages/server/src/outbox.ts`:

1. `RENAME outbox:{projectId}:{nodeId}` → `outbox:{projectId}:{nodeId}:draining`
2. `LRANGE outbox:{projectId}:{nodeId}:draining 0 -1`
3. `DEL outbox:{projectId}:{nodeId}:draining`

If `RENAME` fails (key doesn't exist), the outbox is empty — return `[]`.

### Fix 3: Server — Conditional presence cleanup on disconnect

**Problem:** `HDEL` on disconnect can clobber a fresh `HSET` from a reconnection on another instance.

**Solution:** In `packages/server/src/hub.ts`, use a Lua script for `unregister`:

```lua
if redis.call("HGET", KEYS[1], ARGV[1]) == ARGV[2] then
  return redis.call("HDEL", KEYS[1], ARGV[1])
end
return 0
```

Only delete if the presence value matches this instance's `instanceId`.

### Fix 4: Node — WSHandlers gets a send callback

**Problem:** WSHandlers has no reference to WSClient and cannot send responses back over the network. This makes `trace_resolve_request` one-way only and blocks proposals.

**Solution:** Add a `sendFn` to WSHandlers constructor:

```typescript
type SendFn = (envelope: Envelope) => void;

class WSHandlers {
  constructor(
    private engine: Engine,
    private store: Store,
    private eventBus: EventBus,
    private sendFn: SendFn | null = null,
  ) {}
}
```

In `index.ts`, wire it after WSClient is created:

```typescript
const wsHandlers = new WSHandlers(engine, store, eventBus, (env) => wsClient?.send(env));
```

Update `trace_resolve_request` handler to send response via `sendFn`.

### Fix 5: Node — Fix /ask routing

**Problem:** `/ask` command always calls `broadcast()` even when a target node is specified.

**Solution:** In `packages/node/src/tui.ts`, when `targetNode` is set, call `this.wsClient.sendMessage(targetNode, payload)` instead of `this.wsClient.broadcast(payload)`.

---

## Part 2: Proposals + Voting System

### Overview

Multi-peer voting system where any node can create a proposal, all peers in the project vote, and the outcome is computed by weighted majority with configurable AI vote weight and owner veto for dispute/sweep types.

### Shared Types

Add to `packages/shared/src/types.ts`:

```typescript
export type ProposalKind =
  | "change_request"
  | "trace_dispute"
  | "sweep_acceptance"
  | "network_membership"
  | "challenge";

export type ProposalStatus = "voting" | "approved" | "rejected" | "expired";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  description: string;
  proposerNode: string;
  proposerName: string;
  ownerNode: string;
  status: ProposalStatus;
  affectedItems: string[];
  deadline: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProposalVote {
  id: string;
  proposalId: string;
  voterNode: string;
  voterName: string;
  decision: "approve" | "reject";
  reason: string;
  isAI: boolean;
  createdAt: string;
}

export interface TallyResult {
  totalEligible: number;
  humanVotes: number;
  aiVotes: number;
  approveScore: number;
  rejectScore: number;
  quorumReached: boolean;
  decision: ProposalStatus;
  ownerVetoed: boolean;
}
```

### Message Payloads

Add to `MessagePayload` union in `packages/shared/src/messages.ts`:

```typescript
| { type: "proposal_create"; proposal: Proposal }
| { type: "proposal_vote"; vote: ProposalVote }
| { type: "proposal_result"; proposalId: string; result: TallyResult }
| { type: "tally_request"; proposalId: string }
```

### SQL Schema

Add to `packages/node/src/store.ts`:

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  proposer_node  TEXT NOT NULL,
  proposer_name  TEXT NOT NULL,
  owner_node     TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'voting',
  affected_items TEXT DEFAULT '[]',
  deadline       TEXT NOT NULL,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS proposal_votes (
  id           TEXT PRIMARY KEY,
  proposal_id  TEXT NOT NULL,
  voter_node   TEXT NOT NULL,
  voter_name   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason       TEXT DEFAULT '',
  is_ai        INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(proposal_id, voter_node)
);

CREATE INDEX IF NOT EXISTS idx_proposal_votes_proposal ON proposal_votes(proposal_id);
```

### Store Methods

Add to `Store` class:

- `createProposal(proposal: Omit<Proposal, "id" | "createdAt" | "resolvedAt">): Proposal`
- `getProposal(id: string): Proposal`
- `updateProposalStatus(id: string, status: ProposalStatus): void`
- `listProposals(status?: ProposalStatus): Proposal[]` — returns all proposals, optionally filtered by status
- `listActiveProposals(): Proposal[]` — shortcut for `listProposals("voting")`
- `countEligibleVoters(project: string): number` — counts approved human peers in project (for quorum)
- `createProposalVote(vote: Omit<ProposalVote, "id" | "createdAt">): ProposalVote`
- `getProposalVotes(proposalId: string): ProposalVote[]`

### ProposalEngine

New file: `packages/node/src/proposal.ts`

```typescript
export class ProposalEngine {
  constructor(
    private store: Store,
    private aiVoteWeight: number = 0.5,
  ) {}

  tally(proposalId: string, project: string): TallyResult
  resolve(proposalId: string, project: string): TallyResult
}
```

**Tally algorithm:**

1. Fetch proposal and all votes
2. List approved peers in project → count human peers as `totalEligible`
3. Separate votes into human and AI
4. Check owner veto (only for `trace_dispute` and `sweep_acceptance`):
   - If `ownerNode` voted `reject`, immediately return `rejected` with `ownerVetoed: true`
5. Compute scores:
   - `approveScore = humanApproves + (aiApproves × aiVoteWeight)`
   - `rejectScore = humanRejects + (aiRejects × aiVoteWeight)`
6. Check quorum: `humanVotes > floor(totalEligible / 2)`
7. If no quorum and deadline passed → `expired`
8. If no quorum and deadline not passed → `voting`
9. If quorum reached: `approveScore > rejectScore` → `approved`, otherwise → `rejected`

**Resolve** calls `tally`, then if decision is terminal (not `voting`), updates proposal status in store. Idempotent for `voting` state.

### Config Addition

Add to `NodeConfig`:

```typescript
voting: {
  aiVoteWeight: number;          // default 0.5
  defaultDeadlineHours: number;  // default 48
}
```

### WS Handler Additions

New cases in `ws-handlers.ts` switch:

- `proposal_create` → `store.createProposal(payload.proposal)`, emit `proposal_create` event
- `proposal_vote` → `store.createProposalVote(payload.vote)`, emit `proposal_vote` event
- `tally_request` → `proposalEngine.tally(payload.proposalId, projectId)`, send `proposal_result` response via `sendFn`
- `proposal_result` → `store.updateProposalStatus(payload.proposalId, payload.result.decision)`, emit `proposal_result` event

### EventBus Additions

Add to `EventType`:

```typescript
| "proposal_create"
| "proposal_vote"
| "proposal_result"
| "tally_request"
```

### TUI Additions

New slash commands:

- `/propose <title>` — interactive: asks for kind, description, affected items, deadline. Creates proposal and broadcasts.
- `/vote <proposalId> approve|reject [reason]` — casts vote and broadcasts.
- `/proposals` — lists active proposals with vote counts.
- `/tally <proposalId>` — shows current tally without resolving.

Event display:
- Incoming `proposal_create` → "📋 New proposal: <title> (kind: <kind>, deadline: <date>)"
- Incoming `proposal_vote` → "🗳️ <voterName> voted <decision> on <proposalTitle>"
- Incoming `proposal_result` → "📊 Proposal <title>: <decision> (approve: <score>, reject: <score>)"

### Testing Strategy

- **ProposalEngine unit tests**: quorum calc, AI weighting, owner veto, tie-breaking, deadline expiry, edge cases (1 peer, all AI peers, no votes)
- **Store tests**: CRUD for proposals and votes, unique constraint on duplicate votes, JSON serialization of affectedItems
- **WS Handler tests**: all 4 message types dispatch correctly, sendFn called for tally_request
- **Integration test**: full lifecycle — create proposal, cast votes, resolve, verify status

### What Gets Modified

| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | Add Proposal, ProposalVote, TallyResult types |
| `packages/shared/src/messages.ts` | Add 4 new MessagePayload variants |
| `packages/node/src/store.ts` | Add proposals + proposal_votes tables and CRUD methods |
| `packages/node/src/ws-handlers.ts` | Add sendFn parameter, add 4 new message handlers |
| `packages/node/src/event-bus.ts` | Add 4 new event types |
| `packages/node/src/config.ts` | Add voting config section |
| `packages/node/src/tui.ts` | Add /propose, /vote, /proposals, /tally commands + event display |
| `packages/node/src/index.ts` | Wire ProposalEngine, pass sendFn to WSHandlers |
| `packages/server/src/index.ts` | Enforce projectId/fromNode (Fix 1) |
| `packages/server/src/outbox.ts` | Atomic drain (Fix 2) |
| `packages/server/src/hub.ts` | Conditional unregister (Fix 3) |

### New Files

| File | Purpose |
|------|---------|
| `packages/node/src/proposal.ts` | ProposalEngine with tally + resolve |
| `packages/node/test/proposal.test.ts` | ProposalEngine unit tests |
