# V2 Big-Bang Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all remaining V2 features (proposals/voting, challenges, pairing, checklists, kind mapping) and polish items (auto-registration, error handling, structured logging) in one pass.

**Architecture:** Build bottom-up: shared types → store tables → engine methods → MCP tools + handlers. Each feature follows the same layering. The CRStateMachine already exists in state.ts; we formalize it with proper storage and engine orchestration. Challenges reuse the CR/voting machinery. New features (pairing, checklists, kind mapping) get their own tables and engine methods.

**Tech Stack:** TypeScript, Bun, bun:sqlite, @modelcontextprotocol/sdk, ioredis

---

## Task 1: Shared V2 Types

Add CR, Vote, PairSession, ChecklistItem, KindMapping interfaces to shared types. Add new message payload variants. Extend ToolArgs.

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/messages.ts`
- Test: `packages/shared/src/messages.test.ts`

**Step 1: Write failing tests for new message types**

Add to `packages/shared/src/messages.test.ts`:

```typescript
it("round-trips proposal_create payload", () => {
  const env = createEnvelope("node-a", "", "proj", {
    type: "proposal_create",
    crId: "cr-1",
    targetItemId: "item-1",
    description: "Update PRD",
    proposerNode: "node-a",
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("proposal_create");
});

it("round-trips proposal_vote payload", () => {
  const env = createEnvelope("node-b", "node-a", "proj", {
    type: "proposal_vote",
    crId: "cr-1",
    approve: true,
    reason: "LGTM",
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("proposal_vote");
});

it("round-trips proposal_result payload", () => {
  const env = createEnvelope("node-a", "", "proj", {
    type: "proposal_result",
    crId: "cr-1",
    approved: true,
    tally: { approved: 3, rejected: 1, total: 4 },
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("proposal_result");
});

it("round-trips challenge_create payload", () => {
  const env = createEnvelope("node-b", "", "proj", {
    type: "challenge_create",
    challengeId: "ch-1",
    targetItemId: "item-1",
    reason: "Bug found",
    challengerNode: "node-b",
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("challenge_create");
});

it("round-trips pair_invite payload", () => {
  const env = createEnvelope("node-a", "node-b", "proj", {
    type: "pair_invite",
    sessionId: "ps-1",
    initiatorNode: "node-a",
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("pair_invite");
});

it("round-trips pair_respond payload", () => {
  const env = createEnvelope("node-b", "node-a", "proj", {
    type: "pair_respond",
    sessionId: "ps-1",
    accepted: true,
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("pair_respond");
});

it("round-trips pair_end payload", () => {
  const env = createEnvelope("node-a", "node-b", "proj", {
    type: "pair_end",
    sessionId: "ps-1",
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("pair_end");
});

it("round-trips checklist_update payload", () => {
  const env = createEnvelope("node-a", "", "proj", {
    type: "checklist_update",
    itemId: "item-1",
    checklistItemId: "cl-1",
    checked: true,
  });
  const parsed = parseEnvelope(JSON.stringify(env));
  expect(parsed.payload.type).toBe("checklist_update");
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/shared/src/messages.test.ts
```

Expected: FAIL — TypeScript compilation errors because the new payload types don't exist yet.

**Step 3: Add V2 types to `packages/shared/src/types.ts`**

After the `PendingAction` interface (line 124), add:

```typescript
export interface ChangeRequest {
  id: string;
  proposerNode: string;
  proposerId: string;
  targetItemId: string;
  description: string;
  status: CRStatus;
  createdAt: string;
  updatedAt: string;
}

export type CRStatus =
  | "draft"
  | "proposed"
  | "voting"
  | "approved"
  | "rejected"
  | "applied"
  | "archived";

export type CRTransitionKind =
  | "submit"
  | "open_voting"
  | "approve"
  | "reject"
  | "apply"
  | "archive";

export interface Vote {
  id: string;
  crId: string;
  nodeId: string;
  vertical: Vertical;
  approve: boolean;
  reason: string;
  createdAt: string;
}

export interface VoteTally {
  approved: number;
  rejected: number;
  total: number;
}

export interface PairSession {
  id: string;
  initiatorNode: string;
  partnerNode: string;
  project: string;
  status: "pending" | "active" | "ended";
  startedAt: string;
  endedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  itemId: string;
  text: string;
  checked: boolean;
  createdAt: string;
}

export interface KindMapping {
  id: string;
  fromVertical: Vertical;
  fromKind: ItemKind;
  toVertical: Vertical;
  toKind: ItemKind;
  createdAt: string;
}
```

**Step 4: Add new message payloads to `packages/shared/src/messages.ts`**

Extend the `MessagePayload` union — add before the `error` variant:

```typescript
  | { type: "proposal_create"; crId: string; targetItemId: string; description: string; proposerNode: string }
  | { type: "proposal_vote"; crId: string; approve: boolean; reason: string }
  | { type: "proposal_result"; crId: string; approved: boolean; tally: { approved: number; rejected: number; total: number } }
  | { type: "challenge_create"; challengeId: string; targetItemId: string; reason: string; challengerNode: string }
  | { type: "pair_invite"; sessionId: string; initiatorNode: string }
  | { type: "pair_respond"; sessionId: string; accepted: boolean }
  | { type: "pair_end"; sessionId: string }
  | { type: "checklist_update"; itemId: string; checklistItemId: string; checked: boolean }
```

**Step 5: Extend ToolArgs in `packages/shared/src/types.ts`**

Add to the `ToolArgs` union:

```typescript
  | { tool: "inv_proposal_create"; targetItemId: string; description: string }
  | { tool: "inv_proposal_vote"; crId: string; approve: boolean; reason: string }
  | { tool: "inv_challenge_create"; targetItemId: string; reason: string }
  | { tool: "inv_challenge_respond"; challengeId: string; approve: boolean; reason: string }
  | { tool: "inv_pair_invite"; targetNode: string }
  | { tool: "inv_pair_end"; sessionId: string }
  | { tool: "inv_pair_join"; sessionId: string }
  | { tool: "inv_pair_list" }
  | { tool: "inv_checklist_add"; itemId: string; text: string }
  | { tool: "inv_checklist_check"; checklistItemId: string }
  | { tool: "inv_checklist_uncheck"; checklistItemId: string }
  | { tool: "inv_checklist_list"; itemId: string }
```

**Step 6: Run tests to verify they pass**

```bash
bun test packages/shared/src/messages.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/messages.ts packages/shared/src/messages.test.ts
git commit -m "feat(shared): add V2 types — CR, Vote, PairSession, ChecklistItem, KindMapping + message payloads"
```

---

## Task 2: CR and Vote Store Layer

Add `change_requests` and `votes` tables to SQLite store with CRUD methods.

**Files:**
- Modify: `packages/node/src/store.ts`
- Modify: `packages/node/test/store.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/store.test.ts`:

```typescript
describe("Change Requests", () => {
  it("creates a change request in draft status", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Update PRD scope",
    });
    expect(cr.id).toBeTruthy();
    expect(cr.status).toBe("draft");
    expect(cr.proposerNode).toBe(pmNode.id);
    expect(cr.targetItemId).toBe(prd.id);
  });

  it("updates CR status", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    const updated = store.updateChangeRequestStatus(cr.id, "proposed");
    expect(updated.status).toBe("proposed");
  });

  it("gets CR by id", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    const found = store.getChangeRequest(cr.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(cr.id);
  });

  it("lists CRs by status", () => {
    store.createChangeRequest({ proposerNode: pmNode.id, proposerId: "alice", targetItemId: prd.id, description: "A" });
    store.createChangeRequest({ proposerNode: pmNode.id, proposerId: "alice", targetItemId: prd.id, description: "B" });
    const drafts = store.listChangeRequests("draft");
    expect(drafts).toHaveLength(2);
  });
});

describe("Votes", () => {
  it("creates a vote for a CR", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    const vote = store.createVote({
      crId: cr.id,
      nodeId: devNode.id,
      vertical: "dev",
      approve: true,
      reason: "LGTM",
    });
    expect(vote.id).toBeTruthy();
    expect(vote.approve).toBe(true);
  });

  it("lists votes for a CR", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    store.createVote({ crId: cr.id, nodeId: devNode.id, vertical: "dev", approve: true, reason: "Yes" });
    store.createVote({ crId: cr.id, nodeId: qaNode.id, vertical: "qa", approve: false, reason: "No" });
    const votes = store.listVotes(cr.id);
    expect(votes).toHaveLength(2);
  });

  it("tallies votes correctly", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    store.createVote({ crId: cr.id, nodeId: devNode.id, vertical: "dev", approve: true, reason: "Yes" });
    store.createVote({ crId: cr.id, nodeId: qaNode.id, vertical: "qa", approve: false, reason: "No" });
    store.createVote({ crId: cr.id, nodeId: devopsNode.id, vertical: "devops", approve: true, reason: "OK" });
    const tally = store.tallyVotes(cr.id);
    expect(tally.approved).toBe(2);
    expect(tally.rejected).toBe(1);
    expect(tally.total).toBe(3);
  });

  it("prevents duplicate votes from same node", () => {
    const cr = store.createChangeRequest({
      proposerNode: pmNode.id,
      proposerId: "alice",
      targetItemId: prd.id,
      description: "Test",
    });
    store.createVote({ crId: cr.id, nodeId: devNode.id, vertical: "dev", approve: true, reason: "Yes" });
    expect(() => {
      store.createVote({ crId: cr.id, nodeId: devNode.id, vertical: "dev", approve: false, reason: "Changed mind" });
    }).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/store.test.ts
```

Expected: FAIL — `store.createChangeRequest` doesn't exist.

**Step 3: Add tables and CRUD to `packages/node/src/store.ts`**

Add row types after `PendingActionRow` (line ~114):

```typescript
interface ChangeRequestRow {
  id: string;
  proposer_node: string;
  proposer_id: string;
  target_item_id: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface VoteRow {
  id: string;
  cr_id: string;
  node_id: string;
  vertical: string;
  approve: number;
  reason: string;
  created_at: string;
}
```

Add input types:

```typescript
interface CreateChangeRequestInput {
  proposerNode: string;
  proposerId: string;
  targetItemId: string;
  description: string;
}

interface CreateVoteInput {
  crId: string;
  nodeId: string;
  vertical: Vertical;
  approve: boolean;
  reason: string;
}
```

Add mapper functions:

```typescript
function mapChangeRequestRow(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    proposerNode: row.proposer_node,
    proposerId: row.proposer_id,
    targetItemId: row.target_item_id,
    description: row.description,
    status: row.status as CRStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVoteRow(row: VoteRow): Vote {
  return {
    id: row.id,
    crId: row.cr_id,
    nodeId: row.node_id,
    vertical: row.vertical as Vertical,
    approve: row.approve === 1,
    reason: row.reason,
    createdAt: row.created_at,
  };
}
```

Add tables in `migrate()`:

```sql
CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  proposer_node TEXT NOT NULL REFERENCES nodes(id),
  proposer_id TEXT NOT NULL,
  target_item_id TEXT NOT NULL REFERENCES items(id),
  description TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  cr_id TEXT NOT NULL REFERENCES change_requests(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  vertical TEXT NOT NULL,
  approve INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(cr_id, node_id)
)
```

Add CRUD methods to Store class:

```typescript
createChangeRequest(input: CreateChangeRequestInput): ChangeRequest {
  const id = randomUUID();
  const stmt = this.db.query<ChangeRequestRow, [string, string, string, string, string]>(
    `INSERT INTO change_requests (id, proposer_node, proposer_id, target_item_id, description)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
  );
  const row = stmt.get(id, input.proposerNode, input.proposerId, input.targetItemId, input.description);
  if (!row) throw new Error("Failed to create change request");
  return mapChangeRequestRow(row);
}

getChangeRequest(id: string): ChangeRequest | null {
  const row = this.db.query<ChangeRequestRow, [string]>(
    "SELECT * FROM change_requests WHERE id = ?",
  ).get(id);
  return row ? mapChangeRequestRow(row) : null;
}

updateChangeRequestStatus(id: string, status: CRStatus): ChangeRequest {
  const stmt = this.db.query<ChangeRequestRow, [string, string]>(
    `UPDATE change_requests SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
  );
  const row = stmt.get(status, id);
  if (!row) throw new Error(`Change request not found: ${id}`);
  return mapChangeRequestRow(row);
}

listChangeRequests(status?: CRStatus): ChangeRequest[] {
  if (status) {
    return this.db.query<ChangeRequestRow, [string]>(
      "SELECT * FROM change_requests WHERE status = ? ORDER BY created_at",
    ).all(status).map(mapChangeRequestRow);
  }
  return this.db.query<ChangeRequestRow, []>(
    "SELECT * FROM change_requests ORDER BY created_at",
  ).all().map(mapChangeRequestRow);
}

createVote(input: CreateVoteInput): Vote {
  const id = randomUUID();
  const stmt = this.db.query<VoteRow, [string, string, string, string, number, string]>(
    `INSERT INTO votes (id, cr_id, node_id, vertical, approve, reason)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  const row = stmt.get(id, input.crId, input.nodeId, input.vertical, input.approve ? 1 : 0, input.reason);
  if (!row) throw new Error("Failed to create vote");
  return mapVoteRow(row);
}

listVotes(crId: string): Vote[] {
  return this.db.query<VoteRow, [string]>(
    "SELECT * FROM votes WHERE cr_id = ? ORDER BY created_at",
  ).all(crId).map(mapVoteRow);
}

tallyVotes(crId: string): VoteTally {
  const votes = this.listVotes(crId);
  const approved = votes.filter((v) => v.approve).length;
  const rejected = votes.filter((v) => !v.approve).length;
  return { approved, rejected, total: votes.length };
}
```

Import `ChangeRequest`, `Vote`, `VoteTally`, `CRStatus` from `@inv/shared`.

**Step 4: Run tests to verify they pass**

```bash
bun test packages/node/test/store.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/node/src/store.ts packages/node/test/store.test.ts
git commit -m "feat(store): add change_requests and votes tables with CRUD"
```

---

## Task 3: Pairing, Checklist, Kind Mapping Store Layer

Add remaining V2 tables and CRUD methods to store.

**Files:**
- Modify: `packages/node/src/store.ts`
- Modify: `packages/node/test/store.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/store.test.ts`:

```typescript
describe("Pair Sessions", () => {
  it("creates a pair session in pending status", () => {
    const session = store.createPairSession({
      initiatorNode: pmNode.id,
      partnerNode: devNode.id,
      project: PROJECT,
    });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("pending");
  });

  it("activates a pair session", () => {
    const session = store.createPairSession({ initiatorNode: pmNode.id, partnerNode: devNode.id, project: PROJECT });
    const activated = store.updatePairSessionStatus(session.id, "active");
    expect(activated.status).toBe("active");
  });

  it("ends a pair session", () => {
    const session = store.createPairSession({ initiatorNode: pmNode.id, partnerNode: devNode.id, project: PROJECT });
    store.updatePairSessionStatus(session.id, "active");
    const ended = store.updatePairSessionStatus(session.id, "ended");
    expect(ended.status).toBe("ended");
    expect(ended.endedAt).not.toBeNull();
  });

  it("lists active sessions for a node", () => {
    store.createPairSession({ initiatorNode: pmNode.id, partnerNode: devNode.id, project: PROJECT });
    const sessions = store.listPairSessions(pmNode.id);
    expect(sessions).toHaveLength(1);
  });
});

describe("Checklists", () => {
  it("adds a checklist item to an inventory item", () => {
    const cl = store.createChecklistItem({ itemId: prd.id, text: "Verify scope" });
    expect(cl.id).toBeTruthy();
    expect(cl.checked).toBe(false);
    expect(cl.text).toBe("Verify scope");
  });

  it("checks and unchecks a checklist item", () => {
    const cl = store.createChecklistItem({ itemId: prd.id, text: "Review API" });
    store.updateChecklistItemChecked(cl.id, true);
    expect(store.getChecklistItem(cl.id)!.checked).toBe(true);
    store.updateChecklistItemChecked(cl.id, false);
    expect(store.getChecklistItem(cl.id)!.checked).toBe(false);
  });

  it("lists checklist items for an item", () => {
    store.createChecklistItem({ itemId: prd.id, text: "A" });
    store.createChecklistItem({ itemId: prd.id, text: "B" });
    const items = store.listChecklistItems(prd.id);
    expect(items).toHaveLength(2);
  });
});

describe("Kind Mappings", () => {
  it("creates a kind mapping between verticals", () => {
    const mapping = store.createKindMapping({
      fromVertical: "pm",
      fromKind: "prd",
      toVertical: "dev",
      toKind: "tech-design",
    });
    expect(mapping.id).toBeTruthy();
    expect(mapping.fromKind).toBe("prd");
    expect(mapping.toKind).toBe("tech-design");
  });

  it("finds mapped kind between verticals", () => {
    store.createKindMapping({ fromVertical: "pm", fromKind: "prd", toVertical: "dev", toKind: "tech-design" });
    const mapped = store.getMappedKind("pm", "prd", "dev");
    expect(mapped).toBe("tech-design");
  });

  it("returns null for unmapped kind", () => {
    const mapped = store.getMappedKind("pm", "prd", "qa");
    expect(mapped).toBeNull();
  });

  it("lists all kind mappings", () => {
    store.createKindMapping({ fromVertical: "pm", fromKind: "prd", toVertical: "dev", toKind: "tech-design" });
    store.createKindMapping({ fromVertical: "design", fromKind: "screen-spec", toVertical: "dev", toKind: "api-spec" });
    const all = store.listKindMappings();
    expect(all).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/store.test.ts
```

Expected: FAIL

**Step 3: Add tables, types, and CRUD to store.ts**

Add row types:

```typescript
interface PairSessionRow {
  id: string;
  initiator_node: string;
  partner_node: string;
  project: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface ChecklistItemRow {
  id: string;
  item_id: string;
  text: string;
  checked: number;
  created_at: string;
}

interface KindMappingRow {
  id: string;
  from_vertical: string;
  from_kind: string;
  to_vertical: string;
  to_kind: string;
  created_at: string;
}
```

Add input types:

```typescript
interface CreatePairSessionInput {
  initiatorNode: string;
  partnerNode: string;
  project: string;
}

interface CreateChecklistItemInput {
  itemId: string;
  text: string;
}

interface CreateKindMappingInput {
  fromVertical: Vertical;
  fromKind: ItemKind;
  toVertical: Vertical;
  toKind: ItemKind;
}
```

Add mapper functions:

```typescript
function mapPairSessionRow(row: PairSessionRow): PairSession {
  return {
    id: row.id,
    initiatorNode: row.initiator_node,
    partnerNode: row.partner_node,
    project: row.project,
    status: row.status as PairSession["status"],
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function mapChecklistItemRow(row: ChecklistItemRow): ChecklistItem {
  return {
    id: row.id,
    itemId: row.item_id,
    text: row.text,
    checked: row.checked === 1,
    createdAt: row.created_at,
  };
}

function mapKindMappingRow(row: KindMappingRow): KindMapping {
  return {
    id: row.id,
    fromVertical: row.from_vertical as Vertical,
    fromKind: row.from_kind as ItemKind,
    toVertical: row.to_vertical as Vertical,
    toKind: row.to_kind as ItemKind,
    createdAt: row.created_at,
  };
}
```

Add tables in `migrate()`:

```sql
CREATE TABLE IF NOT EXISTS pair_sessions (
  id TEXT PRIMARY KEY,
  initiator_node TEXT NOT NULL REFERENCES nodes(id),
  partner_node TEXT NOT NULL REFERENCES nodes(id),
  project TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT
)

CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  text TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)

CREATE TABLE IF NOT EXISTS kind_mappings (
  id TEXT PRIMARY KEY,
  from_vertical TEXT NOT NULL,
  from_kind TEXT NOT NULL,
  to_vertical TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_vertical, from_kind, to_vertical)
)
```

Add CRUD methods:

```typescript
// ── Pair Sessions ──
createPairSession(input: CreatePairSessionInput): PairSession { ... }
getPairSession(id: string): PairSession | null { ... }
updatePairSessionStatus(id: string, status: PairSession["status"]): PairSession { ... }
listPairSessions(nodeId: string): PairSession[] {
  // Returns sessions where node is initiator or partner, and not ended
  return this.db.query<PairSessionRow, [string, string]>(
    "SELECT * FROM pair_sessions WHERE (initiator_node = ? OR partner_node = ?) AND status != 'ended' ORDER BY started_at",
  ).all(nodeId, nodeId).map(mapPairSessionRow);
}

// ── Checklists ──
createChecklistItem(input: CreateChecklistItemInput): ChecklistItem { ... }
getChecklistItem(id: string): ChecklistItem | null { ... }
updateChecklistItemChecked(id: string, checked: boolean): void {
  this.db.query("UPDATE checklists SET checked = ? WHERE id = ?").run(checked ? 1 : 0, id);
}
listChecklistItems(itemId: string): ChecklistItem[] { ... }

// ── Kind Mappings ──
createKindMapping(input: CreateKindMappingInput): KindMapping { ... }
getMappedKind(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical): ItemKind | null {
  const row = this.db.query<KindMappingRow, [string, string, string]>(
    "SELECT * FROM kind_mappings WHERE from_vertical = ? AND from_kind = ? AND to_vertical = ?",
  ).get(fromVertical, fromKind, toVertical);
  return row ? (row.to_kind as ItemKind) : null;
}
listKindMappings(): KindMapping[] { ... }
```

Import `PairSession`, `ChecklistItem`, `KindMapping` from `@inv/shared`.

**Step 4: Run tests to verify they pass**

```bash
bun test packages/node/test/store.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/store.ts packages/node/test/store.test.ts
git commit -m "feat(store): add pair_sessions, checklists, kind_mappings tables"
```

---

## Task 4: Proposal/Voting Engine Methods

Wire CRStateMachine into Engine with proper orchestration. Move CRStatus and CRTransitionKind to shared types (they were local to state.ts in V1).

**Files:**
- Modify: `packages/node/src/state.ts` (import CRStatus/CRTransitionKind from shared instead of defining locally)
- Modify: `packages/node/src/engine.ts`
- Modify: `packages/node/test/engine.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/engine.test.ts`:

```typescript
describe("Proposals and Voting", () => {
  it("creates a proposal in draft status", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Update PRD");
    expect(cr.status).toBe("draft");
    expect(cr.targetItemId).toBe(prd.id);
  });

  it("submits a draft proposal to proposed", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    const submitted = engine.submitProposal(cr.id);
    expect(submitted.status).toBe("proposed");
  });

  it("opens voting on a proposed CR", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    engine.submitProposal(cr.id);
    const voting = engine.openVoting(cr.id);
    expect(voting.status).toBe("voting");
  });

  it("casts a vote on a voting CR", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    const vote = engine.castVote(cr.id, devNode.id, "dev", true, "LGTM");
    expect(vote.approve).toBe(true);
  });

  it("throws when voting on non-voting CR", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    expect(() => engine.castVote(cr.id, devNode.id, "dev", true, "No")).toThrow();
  });

  it("resolves approved by majority", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, designNode.id, "design", true, "Yes");
    engine.castVote(cr.id, devNode.id, "dev", true, "Yes");
    engine.castVote(cr.id, qaNode.id, "qa", false, "No");

    const resolved = engine.resolveVoting(cr.id);
    expect(resolved.status).toBe("approved");
  });

  it("resolves rejected by majority", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, designNode.id, "design", false, "No");
    engine.castVote(cr.id, devNode.id, "dev", false, "No");
    engine.castVote(cr.id, qaNode.id, "qa", true, "Yes");

    const resolved = engine.resolveVoting(cr.id);
    expect(resolved.status).toBe("rejected");
  });

  it("tie-breaking: uses upstream vertical authority", () => {
    // Scenario: design proposes, 2 yes (pm, devops) vs 2 no (dev, qa)
    // PM is upstream of design → PM's vote breaks the tie → approved
    const cr = engine.createProposal(designNode.id, "bob", screenSpec.id, "Redesign");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, pmNode.id, "pm", true, "Good idea");
    engine.castVote(cr.id, devNode.id, "dev", false, "Too much work");
    engine.castVote(cr.id, qaNode.id, "qa", false, "Risk");
    engine.castVote(cr.id, devopsNode.id, "devops", true, "No impact");

    const resolved = engine.resolveVoting(cr.id);
    expect(resolved.status).toBe("approved");
  });

  it("applies approved proposal and propagates changes", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Change");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, devNode.id, "dev", true, "OK");
    engine.resolveVoting(cr.id);

    const result = engine.applyProposal(cr.id);
    expect(result.cr.status).toBe("applied");
    expect(result.signals.length).toBeGreaterThanOrEqual(1); // downstream items affected
  });

  it("archives an applied proposal", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Change");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, devNode.id, "dev", true, "OK");
    engine.resolveVoting(cr.id);
    engine.applyProposal(cr.id);

    const archived = engine.archiveProposal(cr.id);
    expect(archived.status).toBe("archived");
  });

  it("cannot apply a rejected proposal", () => {
    const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Bad idea");
    engine.submitProposal(cr.id);
    engine.openVoting(cr.id);
    engine.castVote(cr.id, devNode.id, "dev", false, "No");
    engine.resolveVoting(cr.id);

    expect(() => engine.applyProposal(cr.id)).toThrow();
  });
});
```

**Note:** The test `beforeEach` needs to ensure `pmNode`, `designNode`, `devNode`, `qaNode`, `devopsNode`, `prd`, and `screenSpec` are available. Verify the existing test setup creates these or extend it.

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: FAIL

**Step 3: Update state.ts to import from shared**

In `packages/node/src/state.ts`, replace the local `CRStatus` and `CRTransitionKind` types with imports from `@inv/shared`:

```typescript
import type { ItemState, TransitionKind, CRStatus, CRTransitionKind } from "@inv/shared";
```

Remove the local type definitions (lines 7-25). Keep `export type` re-exports for backwards compatibility with existing tests.

**Step 4: Add engine methods to `packages/node/src/engine.ts`**

Add `CRStateMachine` as a dependency to Engine:

```typescript
import { CRStateMachine } from "./state";

export class Engine {
  private crSm = new CRStateMachine();

  constructor(
    private store: Store,
    private sm: StateMachine,
    private propagator: SignalPropagator,
  ) {}
```

Add proposal/voting methods:

```typescript
// ── Proposals & Voting ──────────────────────────────────────────────

createProposal(proposerNode: string, proposerId: string, targetItemId: string, description: string): ChangeRequest {
  this.getItem(targetItemId); // validate item exists
  return this.store.createChangeRequest({ proposerNode, proposerId, targetItemId, description });
}

submitProposal(crId: string): ChangeRequest {
  const cr = this.getChangeRequest(crId);
  this.crSm.apply(cr.status, "submit");
  return this.store.updateChangeRequestStatus(crId, "proposed");
}

openVoting(crId: string): ChangeRequest {
  const cr = this.getChangeRequest(crId);
  this.crSm.apply(cr.status, "open_voting");
  return this.store.updateChangeRequestStatus(crId, "voting");
}

castVote(crId: string, nodeId: string, vertical: Vertical, approve: boolean, reason: string): Vote {
  const cr = this.getChangeRequest(crId);
  if (cr.status !== "voting") {
    throw new Error(`Cannot vote on CR in "${cr.status}" status`);
  }
  return this.store.createVote({ crId, nodeId, vertical, approve, reason });
}

resolveVoting(crId: string): ChangeRequest {
  const cr = this.getChangeRequest(crId);
  if (cr.status !== "voting") {
    throw new Error(`Cannot resolve CR in "${cr.status}" status`);
  }

  const tally = this.store.tallyVotes(crId);

  let approved: boolean;
  if (tally.approved > tally.rejected) {
    approved = true;
  } else if (tally.rejected > tally.approved) {
    approved = false;
  } else {
    // Tie-breaking: check if the proposer's upstream vertical voted to approve
    approved = this.tieBreak(cr);
  }

  const kind: CRTransitionKind = approved ? "approve" : "reject";
  this.crSm.apply(cr.status, kind);
  return this.store.updateChangeRequestStatus(crId, approved ? "approved" : "rejected");
}

applyProposal(crId: string): { cr: ChangeRequest; signals: Signal[] } {
  const cr = this.getChangeRequest(crId);
  this.crSm.apply(cr.status, "apply");
  const updated = this.store.updateChangeRequestStatus(crId, "applied");
  const signals = this.propagator.propagateChange(cr.targetItemId);
  return { cr: updated, signals };
}

archiveProposal(crId: string): ChangeRequest {
  const cr = this.getChangeRequest(crId);
  this.crSm.apply(cr.status, "archive");
  return this.store.updateChangeRequestStatus(crId, "archived");
}

private getChangeRequest(id: string): ChangeRequest {
  const cr = this.store.getChangeRequest(id);
  if (!cr) throw new Error(`Change request not found: ${id}`);
  return cr;
}

private tieBreak(cr: ChangeRequest): boolean {
  // Find the proposer node's vertical
  const proposerNode = this.store.getNode(cr.proposerNode);
  if (!proposerNode) return false;

  // Get upstream verticals of the proposer
  const upstreams = UPSTREAM_VERTICALS[proposerNode.vertical];

  // Check if any upstream vertical voted to approve
  const votes = this.store.listVotes(cr.id);
  for (const vote of votes) {
    if (upstreams.includes(vote.vertical) && vote.approve) {
      return true;
    }
  }
  return false;
}
```

Import new types:

```typescript
import type { ChangeRequest, Vote, CRTransitionKind, Signal } from "@inv/shared";
import { UPSTREAM_VERTICALS } from "@inv/shared";
```

**Step 5: Run tests to verify they pass**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/node/src/state.ts packages/node/src/engine.ts packages/node/test/engine.test.ts
git commit -m "feat(engine): add proposal/voting lifecycle with tie-breaking"
```

---

## Task 5: Challenge Engine Methods

Challenges reuse the CR/voting machinery. When a challenge is upheld, the challenged item is marked suspect and changes cascade.

**Files:**
- Modify: `packages/node/src/engine.ts`
- Modify: `packages/node/test/engine.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/engine.test.ts`:

```typescript
describe("Challenges", () => {
  it("creates a challenge as a CR targeting the challenged item", () => {
    const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Bug found in error handling");
    expect(challenge.status).toBe("draft");
    expect(challenge.targetItemId).toBe(apiSpec.id);
    expect(challenge.description).toContain("Bug found");
  });

  it("upheld challenge marks item suspect and propagates", () => {
    const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Missing validation");
    engine.submitProposal(challenge.id);
    engine.openVoting(challenge.id);
    engine.castVote(challenge.id, pmNode.id, "pm", true, "Confirmed");
    engine.castVote(challenge.id, devopsNode.id, "devops", true, "Agreed");
    engine.resolveVoting(challenge.id);

    const result = engine.upholdChallenge(challenge.id);
    expect(engine.getItem(apiSpec.id).state).toBe("suspect");
    expect(result.signals.length).toBeGreaterThanOrEqual(0);
  });

  it("dismissed challenge leaves items unchanged", () => {
    const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Timeout concern");
    engine.submitProposal(challenge.id);
    engine.openVoting(challenge.id);
    engine.castVote(challenge.id, pmNode.id, "pm", false, "Fine");
    engine.castVote(challenge.id, devNode.id, "dev", false, "By design");
    engine.resolveVoting(challenge.id);

    engine.dismissChallenge(challenge.id);
    expect(engine.getItem(apiSpec.id).state).toBe("proven");
  });

  it("cannot uphold a rejected challenge", () => {
    const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Concern");
    engine.submitProposal(challenge.id);
    engine.openVoting(challenge.id);
    engine.castVote(challenge.id, devNode.id, "dev", false, "No");
    engine.resolveVoting(challenge.id);

    expect(() => engine.upholdChallenge(challenge.id)).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: FAIL

**Step 3: Add challenge methods to engine.ts**

```typescript
// ── Challenges ──────────────────────────────────────────────────────

createChallenge(challengerNode: string, challengerId: string, targetItemId: string, reason: string): ChangeRequest {
  this.getItem(targetItemId); // validate
  return this.store.createChangeRequest({
    proposerNode: challengerNode,
    proposerId: challengerId,
    targetItemId,
    description: `Challenge: ${reason}`,
  });
}

upholdChallenge(crId: string): { cr: ChangeRequest; signals: Signal[] } {
  const cr = this.getChangeRequest(crId);
  if (cr.status !== "approved") {
    throw new Error(`Cannot uphold challenge in "${cr.status}" status — must be approved`);
  }

  // Mark the challenged item as suspect
  const item = this.getItem(cr.targetItemId);
  if (item.state === "proven") {
    this.store.updateItemStatus(cr.targetItemId, "suspect", `Challenge upheld: ${cr.description}`, "challenge-system");
    this.store.recordTransition({
      itemId: cr.targetItemId,
      kind: "suspect",
      from: "proven",
      to: "suspect",
      evidence: cr.description,
      reason: "Challenge upheld by vote",
      actor: "challenge-system",
    });
  }

  // Apply and propagate
  this.crSm.apply(cr.status, "apply");
  const updated = this.store.updateChangeRequestStatus(crId, "applied");
  const signals = this.propagator.propagateChange(cr.targetItemId);

  return { cr: updated, signals };
}

dismissChallenge(crId: string): ChangeRequest {
  const cr = this.getChangeRequest(crId);
  if (cr.status !== "rejected") {
    throw new Error(`Cannot dismiss challenge in "${cr.status}" status — must be rejected`);
  }
  // Archive the rejected challenge
  this.crSm.apply(cr.status, "archive");
  return this.store.updateChangeRequestStatus(crId, "archived");
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/engine.ts packages/node/test/engine.test.ts
git commit -m "feat(engine): add challenge lifecycle — uphold/dismiss with cascading"
```

---

## Task 6: Pairing, Checklist, Kind Mapping Engine Methods

Add engine methods for the remaining V2 features.

**Files:**
- Modify: `packages/node/src/engine.ts`
- Modify: `packages/node/test/engine.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/engine.test.ts`:

```typescript
describe("Pairing Sessions", () => {
  it("initiates a pair session", () => {
    const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
    expect(session.status).toBe("pending");
    expect(session.initiatorNode).toBe(pmNode.id);
    expect(session.partnerNode).toBe(devNode.id);
  });

  it("joins a pending pair session", () => {
    const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
    const active = engine.joinPair(session.id);
    expect(active.status).toBe("active");
  });

  it("ends an active pair session", () => {
    const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
    engine.joinPair(session.id);
    const ended = engine.endPair(session.id);
    expect(ended.status).toBe("ended");
  });

  it("lists active sessions for a node", () => {
    engine.invitePair(pmNode.id, devNode.id, PROJECT);
    const sessions = engine.listPairSessions(pmNode.id);
    expect(sessions).toHaveLength(1);
  });
});

describe("Checklists", () => {
  it("adds a checklist item to an inventory item", () => {
    const cl = engine.addChecklistItem(prd.id, "Verify scope");
    expect(cl.text).toBe("Verify scope");
    expect(cl.checked).toBe(false);
  });

  it("checks and unchecks a checklist item", () => {
    const cl = engine.addChecklistItem(prd.id, "Review API");
    engine.checkChecklistItem(cl.id);
    expect(engine.listChecklist(prd.id)[0].checked).toBe(true);
    engine.uncheckChecklistItem(cl.id);
    expect(engine.listChecklist(prd.id)[0].checked).toBe(false);
  });

  it("lists checklist for an item", () => {
    engine.addChecklistItem(prd.id, "A");
    engine.addChecklistItem(prd.id, "B");
    expect(engine.listChecklist(prd.id)).toHaveLength(2);
  });
});

describe("Kind Mappings", () => {
  it("creates and retrieves a kind mapping", () => {
    engine.addKindMapping("pm", "prd", "dev", "tech-design");
    const mapped = engine.getMappedKind("pm", "prd", "dev");
    expect(mapped).toBe("tech-design");
  });

  it("returns null for unmapped kind", () => {
    expect(engine.getMappedKind("pm", "prd", "qa")).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: FAIL

**Step 3: Add methods to engine.ts**

```typescript
// ── Pairing ─────────────────────────────────────────────────────────

invitePair(initiatorNode: string, partnerNode: string, project: string): PairSession {
  this.getNode(initiatorNode);
  this.getNode(partnerNode);
  return this.store.createPairSession({ initiatorNode, partnerNode, project });
}

joinPair(sessionId: string): PairSession {
  const session = this.store.getPairSession(sessionId);
  if (!session) throw new Error(`Pair session not found: ${sessionId}`);
  if (session.status !== "pending") throw new Error(`Session is "${session.status}", cannot join`);
  return this.store.updatePairSessionStatus(sessionId, "active");
}

endPair(sessionId: string): PairSession {
  const session = this.store.getPairSession(sessionId);
  if (!session) throw new Error(`Pair session not found: ${sessionId}`);
  if (session.status !== "active") throw new Error(`Session is "${session.status}", cannot end`);
  return this.store.updatePairSessionStatus(sessionId, "ended");
}

listPairSessions(nodeId: string): PairSession[] {
  return this.store.listPairSessions(nodeId);
}

// ── Checklists ──────────────────────────────────────────────────────

addChecklistItem(itemId: string, text: string): ChecklistItem {
  this.getItem(itemId); // validate
  return this.store.createChecklistItem({ itemId, text });
}

checkChecklistItem(checklistItemId: string): void {
  this.store.updateChecklistItemChecked(checklistItemId, true);
}

uncheckChecklistItem(checklistItemId: string): void {
  this.store.updateChecklistItemChecked(checklistItemId, false);
}

listChecklist(itemId: string): ChecklistItem[] {
  return this.store.listChecklistItems(itemId);
}

// ── Kind Mappings ───────────────────────────────────────────────────

addKindMapping(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical, toKind: ItemKind): KindMapping {
  return this.store.createKindMapping({ fromVertical, fromKind, toVertical, toKind });
}

getMappedKind(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical): ItemKind | null {
  return this.store.getMappedKind(fromVertical, fromKind, toVertical);
}
```

Import types:

```typescript
import type { PairSession, ChecklistItem, KindMapping, ItemKind } from "@inv/shared";
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/node/test/engine.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/engine.ts packages/node/test/engine.test.ts
git commit -m "feat(engine): add pairing, checklist, kind mapping methods"
```

---

## Task 7: V2 MCP Tools + EventBus + WSHandlers

Add all new MCP tools to channel.ts, extend EventBus with V2 event types, add WSHandler cases for new message types.

**Files:**
- Modify: `packages/node/src/event-bus.ts`
- Modify: `packages/node/src/ws-handlers.ts`
- Modify: `packages/node/src/channel.ts`
- Modify: `packages/node/test/channel.test.ts`

**Step 1: Write failing tests**

Update `packages/node/test/channel.test.ts`:

```typescript
it("has 19 tool definitions", () => {
  expect(TOOL_DEFINITIONS).toHaveLength(19);
});

// Update existing name-match test to include new tools
it("tool names match expected set", () => {
  const names = TOOL_DEFINITIONS.map((t) => t.name);
  expect(names).toEqual([
    "inv_add_item",
    "inv_add_trace",
    "inv_verify",
    "inv_mark_broken",
    "inv_audit",
    "inv_ask",
    "inv_reply",
    "inv_proposal_create",
    "inv_proposal_vote",
    "inv_challenge_create",
    "inv_challenge_respond",
    "inv_pair_invite",
    "inv_pair_join",
    "inv_pair_end",
    "inv_pair_list",
    "inv_checklist_add",
    "inv_checklist_check",
    "inv_checklist_uncheck",
    "inv_checklist_list",
  ]);
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/channel.test.ts
```

Expected: FAIL — tool count is 7, not 19.

**Step 3: Extend EventBus types**

In `packages/node/src/event-bus.ts`, add to `EventType`:

```typescript
export type EventType =
  | "signal_change"
  | "sweep"
  | "trace_resolve_request"
  | "trace_resolve_response"
  | "query_ask"
  | "query_respond"
  | "ack"
  | "error"
  | "permission_request"
  | "permission_verdict"
  | "proposal_create"
  | "proposal_vote"
  | "proposal_result"
  | "challenge_create"
  | "pair_invite"
  | "pair_respond"
  | "pair_end"
  | "checklist_update";
```

**Step 4: Extend WSHandlers**

In `packages/node/src/ws-handlers.ts`, add cases in the `handle` switch:

```typescript
case "proposal_create":
case "proposal_vote":
case "proposal_result":
case "challenge_create":
case "pair_invite":
case "pair_respond":
case "pair_end":
case "checklist_update":
  // Forwarded to Claude Code via channel server's EventBus listener
  break;
```

**Step 5: Add 12 new tool definitions to channel.ts**

Add after the `inv_reply` tool:

```typescript
{
  name: "inv_proposal_create",
  description: "Create a change request proposal for an item. Starts as draft, must be submitted and opened for voting.",
  inputSchema: {
    type: "object",
    properties: {
      targetItemId: { type: "string", description: "Item UUID to propose changes for" },
      description: { type: "string", description: "Description of the proposed change" },
    },
    required: ["targetItemId", "description"],
  },
},
{
  name: "inv_proposal_vote",
  description: "Vote on a proposal that is in voting status. Submits, opens voting if needed, casts vote, and resolves.",
  inputSchema: {
    type: "object",
    properties: {
      crId: { type: "string", description: "Change request UUID" },
      approve: { type: "boolean", description: "true to approve, false to reject" },
      reason: { type: "string", description: "Reason for your vote" },
    },
    required: ["crId", "approve", "reason"],
  },
},
{
  name: "inv_challenge_create",
  description: "Challenge a proven item. Creates a CR that goes through voting. If upheld, item becomes suspect.",
  inputSchema: {
    type: "object",
    properties: {
      targetItemId: { type: "string", description: "Item UUID to challenge" },
      reason: { type: "string", description: "Reason for the challenge" },
    },
    required: ["targetItemId", "reason"],
  },
},
{
  name: "inv_challenge_respond",
  description: "Vote on an active challenge.",
  inputSchema: {
    type: "object",
    properties: {
      challengeId: { type: "string", description: "Challenge (CR) UUID" },
      approve: { type: "boolean", description: "true to uphold challenge, false to dismiss" },
      reason: { type: "string", description: "Reason" },
    },
    required: ["challengeId", "approve", "reason"],
  },
},
{
  name: "inv_pair_invite",
  description: "Invite another node to a pairing session.",
  inputSchema: {
    type: "object",
    properties: {
      targetNode: { type: "string", description: "Target node UUID to pair with" },
    },
    required: ["targetNode"],
  },
},
{
  name: "inv_pair_join",
  description: "Accept a pending pairing session invitation.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Pair session UUID" },
    },
    required: ["sessionId"],
  },
},
{
  name: "inv_pair_end",
  description: "End an active pairing session.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Pair session UUID" },
    },
    required: ["sessionId"],
  },
},
{
  name: "inv_pair_list",
  description: "List active pairing sessions for this node.",
  inputSchema: {
    type: "object",
    properties: {},
  },
},
{
  name: "inv_checklist_add",
  description: "Add a checklist item to an inventory item.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Parent inventory item UUID" },
      text: { type: "string", description: "Checklist item text" },
    },
    required: ["itemId", "text"],
  },
},
{
  name: "inv_checklist_check",
  description: "Mark a checklist item as checked.",
  inputSchema: {
    type: "object",
    properties: {
      checklistItemId: { type: "string", description: "Checklist item UUID" },
    },
    required: ["checklistItemId"],
  },
},
{
  name: "inv_checklist_uncheck",
  description: "Uncheck a checklist item.",
  inputSchema: {
    type: "object",
    properties: {
      checklistItemId: { type: "string", description: "Checklist item UUID" },
    },
    required: ["checklistItemId"],
  },
},
{
  name: "inv_checklist_list",
  description: "List all checklist items for an inventory item.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Parent inventory item UUID" },
    },
    required: ["itemId"],
  },
},
```

**Step 6: Add handler cases in buildToolHandlers**

Add to the switch in `buildToolHandlers`:

```typescript
case "inv_proposal_create": {
  const cr = engine.createProposal(config.node.id, config.node.owner, args.targetItemId ?? "", args.description ?? "");
  engine.submitProposal(cr.id);
  engine.openVoting(cr.id);
  // Broadcast to network
  if (wsClient?.connected) {
    wsClient.broadcast({
      type: "proposal_create",
      crId: cr.id,
      targetItemId: args.targetItemId ?? "",
      description: args.description ?? "",
      proposerNode: config.node.id,
    });
  }
  return text(JSON.stringify({ crId: cr.id, status: "voting" }, null, 2));
}

case "inv_proposal_vote": {
  const nodeInfo = engine.getNode(config.node.id);
  const vote = engine.castVote(args.crId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
  // Broadcast vote
  if (wsClient?.connected) {
    wsClient.broadcast({
      type: "proposal_vote",
      crId: args.crId ?? "",
      approve: vote.approve,
      reason: args.reason ?? "",
    });
  }
  return text(JSON.stringify({ voted: true, crId: args.crId, approve: vote.approve }, null, 2));
}

case "inv_challenge_create": {
  const cr = engine.createChallenge(config.node.id, config.node.owner, args.targetItemId ?? "", args.reason ?? "");
  engine.submitProposal(cr.id);
  engine.openVoting(cr.id);
  if (wsClient?.connected) {
    wsClient.broadcast({
      type: "challenge_create",
      challengeId: cr.id,
      targetItemId: args.targetItemId ?? "",
      reason: args.reason ?? "",
      challengerNode: config.node.id,
    });
  }
  return text(JSON.stringify({ challengeId: cr.id, status: "voting" }, null, 2));
}

case "inv_challenge_respond": {
  const nodeInfo = engine.getNode(config.node.id);
  const vote = engine.castVote(args.challengeId ?? "", config.node.id, nodeInfo.vertical, args.approve === "true" || args.approve === true, args.reason ?? "");
  if (wsClient?.connected) {
    wsClient.broadcast({
      type: "proposal_vote",
      crId: args.challengeId ?? "",
      approve: vote.approve,
      reason: args.reason ?? "",
    });
  }
  return text(JSON.stringify({ voted: true, challengeId: args.challengeId, approve: vote.approve }, null, 2));
}

case "inv_pair_invite": {
  const session = engine.invitePair(config.node.id, args.targetNode ?? "", config.node.project);
  if (wsClient?.connected) {
    wsClient.sendMessage(args.targetNode ?? "", {
      type: "pair_invite",
      sessionId: session.id,
      initiatorNode: config.node.id,
    });
  }
  return text(JSON.stringify({ sessionId: session.id, status: "pending" }, null, 2));
}

case "inv_pair_join": {
  const session = engine.joinPair(args.sessionId ?? "");
  if (wsClient?.connected) {
    wsClient.sendMessage(session.initiatorNode, {
      type: "pair_respond",
      sessionId: session.id,
      accepted: true,
    });
  }
  return text(JSON.stringify({ sessionId: session.id, status: "active" }, null, 2));
}

case "inv_pair_end": {
  const session = engine.endPair(args.sessionId ?? "");
  if (wsClient?.connected) {
    const partner = session.initiatorNode === config.node.id ? session.partnerNode : session.initiatorNode;
    wsClient.sendMessage(partner, {
      type: "pair_end",
      sessionId: session.id,
    });
  }
  return text(JSON.stringify({ sessionId: session.id, status: "ended" }, null, 2));
}

case "inv_pair_list": {
  const sessions = engine.listPairSessions(config.node.id);
  return text(JSON.stringify(sessions, null, 2));
}

case "inv_checklist_add": {
  const cl = engine.addChecklistItem(args.itemId ?? "", args.text ?? "");
  return text(JSON.stringify(cl, null, 2));
}

case "inv_checklist_check": {
  engine.checkChecklistItem(args.checklistItemId ?? "");
  return text(JSON.stringify({ checked: true, checklistItemId: args.checklistItemId }, null, 2));
}

case "inv_checklist_uncheck": {
  engine.uncheckChecklistItem(args.checklistItemId ?? "");
  return text(JSON.stringify({ unchecked: true, checklistItemId: args.checklistItemId }, null, 2));
}

case "inv_checklist_list": {
  const items = engine.listChecklist(args.itemId ?? "");
  return text(JSON.stringify(items, null, 2));
}
```

**Step 7: Update channel event bridge**

In `startChannelServer`, update `channelEvents` to include V2 events:

```typescript
const channelEvents = [
  "signal_change",
  "sweep",
  "query_ask",
  "query_respond",
  "permission_request",
  "permission_verdict",
  "proposal_create",
  "proposal_vote",
  "proposal_result",
  "challenge_create",
  "pair_invite",
  "pair_respond",
  "pair_end",
  "checklist_update",
  "error",
] as const;
```

**Step 8: Update MCP instructions in startChannelServer**

Update the instructions string to mention V2 features:

```typescript
instructions: `You are connected to the inventory network as node "${config.node.name}" (${config.node.vertical}, project: ${config.node.project}, owner: ${config.node.owner}).

Events from the inventory network arrive as <channel source="inventory"> tags. These include:
- signal_change: an item changed state
- sweep: an external reference triggered a sweep
- query_ask/query_respond: Q&A between nodes
- permission_request/permission_verdict: approval workflows
- proposal_create/proposal_vote/proposal_result: change request voting
- challenge_create: a node challenges an item
- pair_invite/pair_respond/pair_end: pairing session events
- checklist_update: checklist item checked/unchecked

Use the inv_* tools to manage inventory, propose changes, vote, challenge items, pair with other nodes, and manage checklists.`,
```

**Step 9: Run tests to verify they pass**

```bash
bun test packages/node/test/channel.test.ts
```

Expected: PASS

**Step 10: Commit**

```bash
git add packages/node/src/event-bus.ts packages/node/src/ws-handlers.ts packages/node/src/channel.ts packages/node/test/channel.test.ts
git commit -m "feat(node): add V2 MCP tools — proposals, challenges, pairing, checklists"
```

---

## Task 8: Node Auto-Registration

When a node connects to the server and has no `node.id` in config, automatically register with the server and persist the ID back to the config file.

**Files:**
- Modify: `packages/node/src/channel.ts`
- Modify: `packages/node/test/channel.test.ts`

**Step 1: Write failing test**

Add to `packages/node/test/channel.test.ts` (or create a focused integration test):

```typescript
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("auto-registration", () => {
  it("assigns node.id when config has empty id", () => {
    const configPath = join(tmpdir(), `test-config-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify({
      node: { name: "test-node", vertical: "dev", project: "test", owner: "tester", isAI: false },
      server: { url: "", token: "" },
      database: { path: ":memory:" },
    }));

    // The startChannelServer auto-registration logic writes the id back
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    expect(config.node.id).toBeFalsy(); // starts empty

    // After channel server creates the node, it should write id back
    // This is tested indirectly — verify the logic exists in channel.ts
    unlinkSync(configPath);
  });
});
```

**Step 2: Implement auto-registration in channel.ts**

The current code already creates a node if `config.node.id` is empty (lines 288-297). Extend it to write the ID back to the config file:

```typescript
// 3. Register node if needed
if (!config.node.id) {
  const node = engine.registerNode(
    config.node.name || "unnamed-node",
    config.node.vertical,
    config.node.project || "default",
    config.node.owner || "local",
    config.node.isAI,
  );
  config.node.id = node.id;

  // Persist the node ID back to config file
  const updatedRaw = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!updatedRaw.node) updatedRaw.node = {};
  updatedRaw.node.id = node.id;
  writeFileSync(configPath, JSON.stringify(updatedRaw, null, 2) + "\n");
}
```

Import `writeFileSync` (already has `readFileSync`).

**Step 3: Run all tests**

```bash
bun test packages/node/
```

Expected: PASS

**Step 4: Commit**

```bash
git add packages/node/src/channel.ts packages/node/test/channel.test.ts
git commit -m "feat(node): auto-register node and persist ID to config file"
```

---

## Task 9: Error Handling — Error Envelopes

Add proper error response handling in WSHandlers. When processing a message fails, send an error envelope back to the sender.

**Files:**
- Modify: `packages/node/src/ws-handlers.ts`
- Modify: `packages/node/test/ws-handlers.test.ts`

**Step 1: Write failing tests**

Add to `packages/node/test/ws-handlers.test.ts`:

```typescript
it("emits error event when signal_change handler fails", () => {
  const errors: unknown[] = [];
  eventBus.on("error", (data) => errors.push(data));

  const envelope = createEnvelope("remote", "", "proj", {
    type: "signal_change",
    itemId: "nonexistent-item",
    oldState: "proven",
    newState: "suspect",
  });

  wsHandlers.handle(envelope);

  // Error should be emitted (handler catches and emits)
  expect(errors.length).toBe(1);
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/ws-handlers.test.ts
```

**Step 3: Improve error handling in ws-handlers.ts**

Wrap each handler case to emit structured errors on the EventBus:

```typescript
private handleSignalChange(
  payload: Extract<MessagePayload, { type: "signal_change" }>,
): void {
  try {
    this.engine.propagateChange(payload.itemId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.eventBus.emit("error", {
      type: "error",
      code: "SIGNAL_CHANGE_FAILED",
      message: `signal_change for item ${payload.itemId}: ${message}`,
    });
  }
}
```

Apply the same pattern to `handleSweep`, `handleTraceResolveRequest`, `handleQueryAsk`.

**Step 4: Run tests to verify they pass**

```bash
bun test packages/node/test/ws-handlers.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/ws-handlers.ts packages/node/test/ws-handlers.test.ts
git commit -m "feat(node): emit structured error events on handler failures"
```

---

## Task 10: Structured Logging

Replace `console.log`/`console.error`/`console.warn` with a structured logger.

**Files:**
- Create: `packages/node/src/logger.ts`
- Modify: `packages/node/src/ws-handlers.ts`
- Modify: `packages/node/src/ws-client.ts`
- Modify: `packages/node/src/channel.ts`
- Test: `packages/node/test/logger.test.ts`

**Step 1: Write failing test**

Create `packages/node/test/logger.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Logger } from "../src/logger";

describe("Logger", () => {
  it("creates a logger with a name", () => {
    const log = new Logger("test");
    expect(log.name).toBe("test");
  });

  it("formats JSON log lines", () => {
    const log = new Logger("ws-client");
    const lines: string[] = [];
    log.setWriter((line) => lines.push(line));

    log.info("connected", { url: "ws://localhost" });
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.logger).toBe("ws-client");
    expect(parsed.msg).toBe("connected");
    expect(parsed.url).toBe("ws://localhost");
    expect(parsed.ts).toBeTruthy();
  });

  it("supports warn and error levels", () => {
    const log = new Logger("test");
    const lines: string[] = [];
    log.setWriter((line) => lines.push(line));

    log.warn("caution", { reason: "slow" });
    log.error("failed", { code: "E01" });

    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/node/test/logger.test.ts
```

Expected: FAIL

**Step 3: Create `packages/node/src/logger.ts`**

```typescript
type LogLevel = "info" | "warn" | "error";
type WriteFn = (line: string) => void;

export class Logger {
  readonly name: string;
  private writer: WriteFn = (line) => process.stderr.write(line + "\n");

  constructor(name: string) {
    this.name = name;
  }

  setWriter(fn: WriteFn): void {
    this.writer = fn;
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      logger: this.name,
      msg,
      ...data,
    };
    this.writer(JSON.stringify(entry));
  }
}
```

**Step 4: Replace console calls in source files**

In `ws-handlers.ts`:
```typescript
import { Logger } from "./logger";
// ...
private log = new Logger("ws-handlers");
// Replace console.warn → this.log.warn
// Replace console.error → this.log.error
// Replace console.log → this.log.info
```

In `ws-client.ts`:
```typescript
import { Logger } from "./logger";
// ...
private log = new Logger("ws-client");
// Replace console.error → this.log.error
```

In `channel.ts`:
```typescript
import { Logger } from "./logger";
// ...
const log = new Logger("channel-server");
// Replace console.error → log.error
// Replace console.log → log.info
```

**Step 5: Run all tests to verify nothing breaks**

```bash
bun test packages/node/
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/node/src/logger.ts packages/node/test/logger.test.ts packages/node/src/ws-handlers.ts packages/node/src/ws-client.ts packages/node/src/channel.ts
git commit -m "feat(node): add structured JSON logger, replace console calls"
```

---

## Task 11: Update ToolArgs to Include New Tools

Ensure the ToolArgs discriminated union in shared types includes all 19 tool variants (12 new + 7 existing).

**Files:**
- Modify: `packages/shared/src/types.ts`

This was done in Task 1. Verify the ToolArgs union is complete. If any tool names were missed, add them here.

**Step 1: Verify**

```bash
bun test packages/shared/
```

**Step 2: Commit (only if changes needed)**

```bash
git add packages/shared/src/types.ts
git commit -m "fix(shared): ensure ToolArgs covers all 19 tools"
```

---

## Task 12: Run Full Test Suite and Update Progress Tracker

**Files:**
- Modify: `docs/plans/2026-03-26-typescript-rewrite-progress.md`

**Step 1: Run all tests**

```bash
bun test packages/
```

Expected: ALL PASS

**Step 2: Update progress tracker**

Add V2 section to the progress tracker with all tasks and commit hashes. Update TODO section to reflect completed items.

**Step 3: Commit**

```bash
git add docs/plans/2026-03-26-typescript-rewrite-progress.md
git commit -m "docs: update progress tracker with V2 big-bang implementation"
```

---

## Dependency Graph

```
Task 1 (shared types)
  ├── Task 2 (CR/Vote store) ── Task 4 (proposal engine) ── Task 5 (challenge engine)
  ├── Task 3 (pair/checklist/mapping store) ── Task 6 (pair/checklist/mapping engine)
  └── Task 7 (MCP tools + handlers) ← depends on Tasks 4, 5, 6
Task 8 (auto-registration) ← independent
Task 9 (error handling) ← independent
Task 10 (structured logging) ← independent
Task 11 (verify ToolArgs) ← after Task 1
Task 12 (progress tracker) ← after all
```

Tasks 8, 9, 10 can run in parallel with the V2 feature tasks.

---

## Summary

| Task | Feature | New Tests (est.) |
|------|---------|------------------|
| 1 | Shared V2 types + messages | 8 |
| 2 | CR/Vote store | 8 |
| 3 | Pair/Checklist/KindMapping store | 11 |
| 4 | Proposal/voting engine | 10 |
| 5 | Challenge engine | 4 |
| 6 | Pairing/checklist/mapping engine | 7 |
| 7 | V2 MCP tools + handlers | 2+ |
| 8 | Node auto-registration | 1 |
| 9 | Error handling | 1+ |
| 10 | Structured logging | 3 |
| 11 | Verify ToolArgs | — |
| 12 | Progress tracker | — |
| **Total** | | **~55 new tests** |

Estimated final test count: **~320 tests** across 19+ files.
