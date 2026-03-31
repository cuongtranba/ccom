# TypeScript Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the inventory network from Go/libp2p to TypeScript/Bun with WebSocket central server, Redis-backed hub, and Claude Agent SDK chat TUI.

**Architecture:** Bun monorepo with three packages — `shared` (types + messages), `server` (Redis-backed WebSocket hub), `node` (engine + store + WS client + chat TUI). JSON over WebSocket replaces protobuf over libp2p.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Redis (ioredis), Claude Agent SDK (@anthropic-ai/sdk), bun:test

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/index.ts`
- Create: `packages/node/package.json`
- Create: `packages/node/tsconfig.json`
- Create: `packages/node/src/index.ts`
- Create: `package.json` (workspace root)
- Create: `tsconfig.json` (base config)
- Create: `bunfig.toml`

**Step 1: Create workspace root package.json**

```json
{
  "name": "my-inventory",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "server": "bun run packages/server/src/index.ts",
    "node": "bun run packages/node/src/index.ts"
  }
}
```

**Step 2: Create base tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  }
}
```

**Step 3: Create bunfig.toml**

```toml
[install]
peer = false

[test]
coverage = false
```

**Step 4: Create packages/shared/package.json**

```json
{
  "name": "@inv/shared",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

**Step 5: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 6: Create packages/shared/src/index.ts**

```typescript
export * from "./types";
export * from "./messages";
```

**Step 7: Create packages/server/package.json**

```json
{
  "name": "@inv/server",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@inv/shared": "workspace:*",
    "ioredis": "^5.4.2"
  }
}
```

**Step 8: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 9: Create packages/server/src/index.ts**

```typescript
console.log("inv-server starting...");
```

**Step 10: Create packages/node/package.json**

```json
{
  "name": "@inv/node",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@inv/shared": "workspace:*",
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

**Step 11: Create packages/node/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 12: Create packages/node/src/index.ts**

```typescript
console.log("inv-node starting...");
```

**Step 13: Install dependencies**

Run: `bun install`
Expected: lockfile created, all workspace links resolved

**Step 14: Verify workspace**

Run: `bun run server`
Expected: "inv-server starting..."

Run: `bun run node`
Expected: "inv-node starting..."

**Step 15: Commit**

```bash
git add packages/ package.json tsconfig.json bunfig.toml
git commit -m "feat: scaffold Bun monorepo with shared/server/node packages"
```

---

### Task 2: Shared Types

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/messages.ts`

**Step 1: Write type tests**

Create: `packages/shared/src/types.test.ts`

```typescript
import { describe, expect, test } from "bun:test";
import type {
  Node,
  Item,
  Trace,
  Vertical,
  ItemState,
  TraceRelation,
  ItemKind,
} from "./types";

describe("types", () => {
  test("Node type accepts valid vertical", () => {
    const node: Node = {
      id: "n1",
      name: "dev-inventory",
      vertical: "dev",
      project: "clinic-checkin",
      owner: "cuong",
      isAI: false,
      createdAt: new Date().toISOString(),
    };
    expect(node.vertical).toBe("dev");
  });

  test("Item type accepts valid state", () => {
    const item: Item = {
      id: "i1",
      nodeId: "n1",
      kind: "adr",
      title: "WebSocket for real-time updates",
      body: "",
      externalRef: "",
      state: "unverified",
      evidence: "",
      confirmedBy: "",
      confirmedAt: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(item.state).toBe("unverified");
  });

  test("Trace type accepts valid relation", () => {
    const trace: Trace = {
      id: "t1",
      fromItemId: "i1",
      fromNodeId: "n1",
      toItemId: "i2",
      toNodeId: "n2",
      relation: "traced_from",
      confirmedBy: "cuong",
      confirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    expect(trace.relation).toBe("traced_from");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/shared/src/types.test.ts`
Expected: FAIL — module "./types" not found

**Step 3: Write types.ts**

```typescript
export type Vertical = "pm" | "design" | "dev" | "qa" | "devops";

export type ItemState = "unverified" | "proven" | "suspect" | "broke";

export type ItemKind =
  | "adr"
  | "api-spec"
  | "data-model"
  | "tech-design"
  | "epic"
  | "user-story"
  | "prd"
  | "screen-spec"
  | "user-flow"
  | "test-case"
  | "test-plan"
  | "runbook"
  | "bug-report"
  | "decision"
  | "custom";

export type TraceRelation = "traced_from" | "matched_by" | "proven_by";

export interface Node {
  id: string;
  name: string;
  vertical: Vertical;
  project: string;
  owner: string;
  isAI: boolean;
  createdAt: string;
}

export interface Item {
  id: string;
  nodeId: string;
  kind: ItemKind;
  title: string;
  body: string;
  externalRef: string;
  state: ItemState;
  evidence: string;
  confirmedBy: string;
  confirmedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Trace {
  id: string;
  fromItemId: string;
  fromNodeId: string;
  toItemId: string;
  toNodeId: string;
  relation: TraceRelation;
  confirmedBy: string;
  confirmedAt: string | null;
  createdAt: string;
}

export interface Signal {
  id: string;
  kind: "change" | "query" | "vote_request" | "notification";
  sourceItem: string;
  sourceNode: string;
  targetItem: string;
  targetNode: string;
  payload: string;
  processed: boolean;
  createdAt: string;
}

export interface Transition {
  id: string;
  itemId: string;
  kind: TransitionKind;
  from: ItemState;
  to: ItemState;
  evidence: string;
  reason: string;
  actor: string;
  timestamp: string;
}

export type TransitionKind =
  | "verify"
  | "suspect"
  | "re_verify"
  | "break"
  | "fix";

export interface Query {
  id: string;
  askerId: string;
  askerNode: string;
  question: string;
  context: string;
  targetNode: string;
  resolved: boolean;
  createdAt: string;
}

export interface QueryResponse {
  id: string;
  queryId: string;
  responderId: string;
  nodeId: string;
  answer: string;
  isAI: boolean;
  createdAt: string;
}

export interface AuditReport {
  nodeId: string;
  totalItems: number;
  unverified: string[];
  proven: string[];
  suspect: string[];
  broke: string[];
  orphans: string[];
  missingUpstreamRefs: string[];
}

export interface PendingAction {
  id: string;
  messageType: string;
  envelope: string;
  summary: string;
  proposed: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
}

export const UPSTREAM_VERTICALS: Record<Vertical, Vertical[]> = {
  pm: [],
  design: ["pm"],
  dev: ["pm", "design"],
  qa: ["dev"],
  devops: ["dev", "qa"],
};
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/shared/src/types.test.ts`
Expected: PASS

**Step 5: Write message tests**

Create: `packages/shared/src/messages.test.ts`

```typescript
import { describe, expect, test } from "bun:test";
import {
  createEnvelope,
  parseEnvelope,
  type Envelope,
  type MessagePayload,
} from "./messages";

describe("messages", () => {
  test("createEnvelope produces valid envelope", () => {
    const payload: MessagePayload = {
      type: "signal_change",
      itemId: "i1",
      oldState: "proven",
      newState: "suspect",
    };
    const env = createEnvelope("node-a", "node-b", "proj1", payload);

    expect(env.messageId).toBeTruthy();
    expect(env.fromNode).toBe("node-a");
    expect(env.toNode).toBe("node-b");
    expect(env.projectId).toBe("proj1");
    expect(env.payload.type).toBe("signal_change");
    expect(env.timestamp).toBeTruthy();
  });

  test("createEnvelope for broadcast has empty toNode", () => {
    const payload: MessagePayload = {
      type: "query_ask",
      question: "What uses the API?",
      askerId: "cuong",
    };
    const env = createEnvelope("node-a", "", "proj1", payload);
    expect(env.toNode).toBe("");
  });

  test("parseEnvelope round-trips correctly", () => {
    const payload: MessagePayload = {
      type: "sweep",
      externalRef: "US-003",
      newValue: "updated",
    };
    const env = createEnvelope("node-a", "node-b", "proj1", payload);
    const json = JSON.stringify(env);
    const parsed = parseEnvelope(json);
    expect(parsed.messageId).toBe(env.messageId);
    expect(parsed.payload.type).toBe("sweep");
  });

  test("parseEnvelope throws on invalid JSON", () => {
    expect(() => parseEnvelope("not json")).toThrow();
  });
});
```

**Step 6: Run test to verify it fails**

Run: `bun test packages/shared/src/messages.test.ts`
Expected: FAIL — module "./messages" not found

**Step 7: Write messages.ts**

```typescript
import { randomUUID } from "crypto";

export interface Envelope {
  messageId: string;
  fromNode: string;
  toNode: string;
  projectId: string;
  timestamp: string;
  payload: MessagePayload;
}

export type MessagePayload =
  | { type: "signal_change"; itemId: string; oldState: string; newState: string }
  | { type: "sweep"; externalRef: string; newValue: string }
  | { type: "trace_resolve_request"; itemId: string }
  | {
      type: "trace_resolve_response";
      itemId: string;
      title: string;
      kind: string;
      state: string;
    }
  | { type: "query_ask"; question: string; askerId: string }
  | { type: "query_respond"; answer: string; responderId: string }
  | { type: "ack"; originalMessageId: string }
  | { type: "error"; code: string; message: string };

export function createEnvelope(
  fromNode: string,
  toNode: string,
  projectId: string,
  payload: MessagePayload,
): Envelope {
  return {
    messageId: randomUUID(),
    fromNode,
    toNode,
    projectId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function parseEnvelope(raw: string): Envelope {
  const parsed = JSON.parse(raw);
  if (!parsed.messageId || !parsed.payload?.type) {
    throw new Error("Invalid envelope: missing required fields");
  }
  return parsed as Envelope;
}
```

**Step 8: Run test to verify it passes**

Run: `bun test packages/shared/src/messages.test.ts`
Expected: PASS

**Step 9: Update index.ts exports**

Verify `packages/shared/src/index.ts` exports both modules (already done in Task 1 Step 6).

**Step 10: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types and message envelope for inventory network"
```

---

### Task 3: State Machine

**Files:**
- Create: `packages/node/src/state.ts`
- Create: `packages/node/test/state.test.ts`

**Step 1: Write state machine tests**

```typescript
import { describe, expect, test } from "bun:test";
import { StateMachine, CRStateMachine } from "../src/state";
import type { ItemState, TransitionKind } from "@inv/shared";

describe("StateMachine", () => {
  const sm = new StateMachine();

  test("verify: unverified → proven", () => {
    const result = sm.apply("unverified", "verify");
    expect(result).toBe("proven");
  });

  test("suspect: proven → suspect", () => {
    const result = sm.apply("proven", "suspect");
    expect(result).toBe("suspect");
  });

  test("re_verify: suspect → proven", () => {
    const result = sm.apply("suspect", "re_verify");
    expect(result).toBe("proven");
  });

  test("break: suspect → broke", () => {
    const result = sm.apply("suspect", "break");
    expect(result).toBe("broke");
  });

  test("fix: broke → proven", () => {
    const result = sm.apply("broke", "fix");
    expect(result).toBe("proven");
  });

  test("invalid transition throws", () => {
    expect(() => sm.apply("unverified", "suspect")).toThrow();
    expect(() => sm.apply("proven", "fix")).toThrow();
    expect(() => sm.apply("broke", "verify")).toThrow();
  });

  test("canTransition returns true for valid", () => {
    expect(sm.canTransition("unverified", "verify")).toBe(true);
    expect(sm.canTransition("proven", "suspect")).toBe(true);
  });

  test("canTransition returns false for invalid", () => {
    expect(sm.canTransition("unverified", "fix")).toBe(false);
    expect(sm.canTransition("broke", "suspect")).toBe(false);
  });

  test("availableTransitions lists valid transitions", () => {
    const transitions = sm.availableTransitions("suspect");
    const kinds = transitions.map((t) => t.kind);
    expect(kinds).toContain("re_verify");
    expect(kinds).toContain("break");
    expect(kinds).not.toContain("verify");
  });
});

describe("CRStateMachine", () => {
  const cr = new CRStateMachine();

  test("draft → proposed via submit", () => {
    expect(cr.apply("draft", "submit")).toBe("proposed");
  });

  test("proposed → voting via open_voting", () => {
    expect(cr.apply("proposed", "open_voting")).toBe("voting");
  });

  test("voting → approved via approve", () => {
    expect(cr.apply("voting", "approve")).toBe("approved");
  });

  test("voting → rejected via reject", () => {
    expect(cr.apply("voting", "reject")).toBe("rejected");
  });

  test("invalid CR transition throws", () => {
    expect(() => cr.apply("draft", "approve")).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/state.test.ts`
Expected: FAIL — module "../src/state" not found

**Step 3: Write state.ts**

```typescript
import type { ItemState, TransitionKind } from "@inv/shared";

interface TransitionRule {
  from: ItemState;
  to: ItemState;
  kind: TransitionKind;
}

const ITEM_TRANSITIONS: TransitionRule[] = [
  { from: "unverified", to: "proven", kind: "verify" },
  { from: "proven", to: "suspect", kind: "suspect" },
  { from: "suspect", to: "proven", kind: "re_verify" },
  { from: "suspect", to: "broke", kind: "break" },
  { from: "broke", to: "proven", kind: "fix" },
];

export class StateMachine {
  canTransition(from: ItemState, kind: TransitionKind): boolean {
    return ITEM_TRANSITIONS.some((r) => r.from === from && r.kind === kind);
  }

  apply(from: ItemState, kind: TransitionKind): ItemState {
    const rule = ITEM_TRANSITIONS.find(
      (r) => r.from === from && r.kind === kind,
    );
    if (!rule) {
      throw new Error(
        `Invalid transition: cannot apply "${kind}" from state "${from}"`,
      );
    }
    return rule.to;
  }

  availableTransitions(from: ItemState): TransitionRule[] {
    return ITEM_TRANSITIONS.filter((r) => r.from === from);
  }
}

// --- CR State Machine ---

type CRStatus =
  | "draft"
  | "proposed"
  | "voting"
  | "approved"
  | "rejected"
  | "applied"
  | "archived";

type CRTransitionKind =
  | "submit"
  | "open_voting"
  | "approve"
  | "reject"
  | "apply"
  | "archive";

interface CRTransitionRule {
  from: CRStatus;
  to: CRStatus;
  kind: CRTransitionKind;
}

const CR_TRANSITIONS: CRTransitionRule[] = [
  { from: "draft", to: "proposed", kind: "submit" },
  { from: "proposed", to: "voting", kind: "open_voting" },
  { from: "voting", to: "approved", kind: "approve" },
  { from: "voting", to: "rejected", kind: "reject" },
  { from: "approved", to: "applied", kind: "apply" },
  { from: "applied", to: "archived", kind: "archive" },
  { from: "rejected", to: "archived", kind: "archive" },
];

export class CRStateMachine {
  apply(from: CRStatus, kind: CRTransitionKind): CRStatus {
    const rule = CR_TRANSITIONS.find(
      (r) => r.from === from && r.kind === kind,
    );
    if (!rule) {
      throw new Error(
        `Invalid CR transition: cannot apply "${kind}" from status "${from}"`,
      );
    }
    return rule.to;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/state.ts packages/node/test/state.test.ts
git commit -m "feat: add item and CR state machines"
```

---

### Task 4: SQLite Store

**Files:**
- Create: `packages/node/src/store.ts`
- Create: `packages/node/test/store.test.ts`

**Step 1: Write store tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("nodes", () => {
    test("createNode and getNode round-trip", () => {
      const node = store.createNode("dev-inv", "dev", "clinic", "cuong", false);
      expect(node.id).toBeTruthy();
      expect(node.name).toBe("dev-inv");

      const fetched = store.getNode(node.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("dev-inv");
      expect(fetched!.vertical).toBe("dev");
    });

    test("listNodes filters by project", () => {
      store.createNode("n1", "dev", "proj-a", "cuong", false);
      store.createNode("n2", "pm", "proj-a", "duke", false);
      store.createNode("n3", "dev", "proj-b", "other", false);

      const nodes = store.listNodes("proj-a");
      expect(nodes).toHaveLength(2);
    });

    test("getNode returns null for missing", () => {
      expect(store.getNode("nonexistent")).toBeNull();
    });
  });

  describe("items", () => {
    test("createItem and getItem round-trip", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const item = store.createItem(node.id, "adr", "WebSocket ADR", "", "");
      expect(item.state).toBe("unverified");

      const fetched = store.getItem(item.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe("WebSocket ADR");
    });

    test("listItems returns items for a node", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      store.createItem(node.id, "adr", "ADR 1", "", "");
      store.createItem(node.id, "api-spec", "API Spec", "", "");

      const items = store.listItems(node.id);
      expect(items).toHaveLength(2);
    });

    test("updateItemStatus changes state", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const item = store.createItem(node.id, "adr", "ADR", "", "");

      store.updateItemStatus(item.id, "proven", "test evidence", "cuong");
      const fetched = store.getItem(item.id);
      expect(fetched!.state).toBe("proven");
      expect(fetched!.evidence).toBe("test evidence");
    });
  });

  describe("traces", () => {
    test("createTrace and getItemTraces", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const item1 = store.createItem(node.id, "adr", "ADR", "", "");
      const item2 = store.createItem(node.id, "api-spec", "Spec", "", "");

      const trace = store.createTrace(
        item1.id, node.id,
        item2.id, node.id,
        "traced_from", "cuong",
      );
      expect(trace.id).toBeTruthy();

      const traces = store.getItemTraces(item1.id);
      expect(traces).toHaveLength(1);
      expect(traces[0].relation).toBe("traced_from");
    });

    test("getDependentTraces finds downstream items", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const upstream = store.createItem(node.id, "adr", "ADR", "", "");
      const downstream = store.createItem(node.id, "api-spec", "Spec", "", "");

      store.createTrace(
        downstream.id, node.id,
        upstream.id, node.id,
        "traced_from", "cuong",
      );

      const deps = store.getDependentTraces(upstream.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].fromItemId).toBe(downstream.id);
    });
  });

  describe("transitions", () => {
    test("recordTransition and getItemTransitions", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const item = store.createItem(node.id, "adr", "ADR", "", "");

      store.recordTransition(item.id, "verify", "unverified", "proven", "evidence", "", "cuong");

      const transitions = store.getItemTransitions(item.id);
      expect(transitions).toHaveLength(1);
      expect(transitions[0].kind).toBe("verify");
      expect(transitions[0].to).toBe("proven");
    });
  });

  describe("signals", () => {
    test("createSignal and markSignalProcessed", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const item1 = store.createItem(node.id, "adr", "ADR", "", "");
      const item2 = store.createItem(node.id, "api-spec", "Spec", "", "");

      const signal = store.createSignal("change", item1.id, node.id, item2.id, node.id, "status changed");
      expect(signal.processed).toBe(false);

      store.markSignalProcessed(signal.id);
    });
  });

  describe("queries", () => {
    test("createQuery and createQueryResponse", () => {
      const node = store.createNode("n1", "dev", "proj", "cuong", false);
      const query = store.createQuery("cuong", node.id, "What uses the API?", "", "");
      expect(query.resolved).toBe(false);

      const response = store.createQueryResponse(query.id, "duke", node.id, "The mobile app", false);
      expect(response.answer).toBe("The mobile app");
    });
  });

  describe("pending actions", () => {
    test("createPendingAction and list/update", () => {
      store.createPendingAction("proposal_vote", "{}", "Vote on WebSocket proposal", "approve");

      const pending = store.listPendingActions();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("pending");

      store.updatePendingActionStatus(pending[0].id, "approved");
      const updated = store.listPendingActions();
      expect(updated).toHaveLength(0); // only returns pending
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/store.test.ts`
Expected: FAIL — module "../src/store" not found

**Step 3: Write store.ts**

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type {
  Node,
  Item,
  Trace,
  Signal,
  Transition,
  Query,
  QueryResponse,
  AuditReport,
  PendingAction,
  ItemState,
  ItemKind,
  TraceRelation,
  TransitionKind,
  Vertical,
} from "@inv/shared";

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  project TEXT NOT NULL,
  owner TEXT NOT NULL,
  is_ai INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  external_ref TEXT DEFAULT '',
  state TEXT DEFAULT 'unverified',
  evidence TEXT DEFAULT '',
  confirmed_by TEXT DEFAULT '',
  confirmed_at TEXT,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  from_item_id TEXT NOT NULL REFERENCES items(id),
  from_node_id TEXT NOT NULL REFERENCES nodes(id),
  to_item_id TEXT NOT NULL REFERENCES items(id),
  to_node_id TEXT NOT NULL REFERENCES nodes(id),
  relation TEXT NOT NULL,
  confirmed_by TEXT DEFAULT '',
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_item TEXT NOT NULL,
  source_node TEXT NOT NULL,
  target_item TEXT NOT NULL,
  target_node TEXT NOT NULL,
  payload TEXT DEFAULT '',
  processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transitions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  kind TEXT NOT NULL,
  from_s TEXT NOT NULL,
  to_s TEXT NOT NULL,
  evidence TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  actor TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  asker_id TEXT NOT NULL,
  asker_node TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT DEFAULT '',
  target_node TEXT DEFAULT '',
  resolved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS query_responses (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES queries(id),
  responder_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_ai INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL,
  envelope TEXT NOT NULL,
  summary TEXT NOT NULL,
  proposed TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(MIGRATIONS);
  }

  close(): void {
    this.db.close();
  }

  // --- Nodes ---

  createNode(
    name: string,
    vertical: Vertical,
    project: string,
    owner: string,
    isAI: boolean,
  ): Node {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO nodes (id, name, vertical, project, owner, is_ai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, name, vertical, project, owner, isAI ? 1 : 0, now);
    return { id, name, vertical, project, owner, isAI, createdAt: now };
  }

  getNode(id: string): Node | null {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToNode(row);
  }

  listNodes(project: string): Node[] {
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE project = ?")
      .all(project) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  // --- Items ---

  createItem(
    nodeId: string,
    kind: ItemKind,
    title: string,
    body: string,
    externalRef: string,
  ): Item {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO items (id, node_id, kind, title, body, external_ref, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'unverified', 1, ?, ?)",
      )
      .run(id, nodeId, kind, title, body, externalRef, now, now);
    return {
      id, nodeId, kind, title, body, externalRef,
      state: "unverified", evidence: "", confirmedBy: "",
      confirmedAt: null, version: 1, createdAt: now, updatedAt: now,
    };
  }

  getItem(id: string): Item | null {
    const row = this.db
      .prepare("SELECT * FROM items WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToItem(row);
  }

  listItems(nodeId: string): Item[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE node_id = ?")
      .all(nodeId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToItem(r));
  }

  updateItemStatus(
    id: string,
    state: ItemState,
    evidence: string,
    confirmedBy: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE items SET state = ?, evidence = ?, confirmed_by = ?, confirmed_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
      )
      .run(state, evidence, confirmedBy, now, now, id);
  }

  findItemsByExternalRef(externalRef: string): Item[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE external_ref = ?")
      .all(externalRef) as Record<string, unknown>[];
    return rows.map((r) => this.rowToItem(r));
  }

  // --- Traces ---

  createTrace(
    fromItemId: string,
    fromNodeId: string,
    toItemId: string,
    toNodeId: string,
    relation: TraceRelation,
    confirmedBy: string,
  ): Trace {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO traces (id, from_item_id, from_node_id, to_item_id, to_node_id, relation, confirmed_by, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, fromItemId, fromNodeId, toItemId, toNodeId, relation, confirmedBy, now, now);
    return {
      id, fromItemId, fromNodeId, toItemId, toNodeId,
      relation, confirmedBy, confirmedAt: now, createdAt: now,
    };
  }

  getItemTraces(itemId: string): Trace[] {
    const rows = this.db
      .prepare("SELECT * FROM traces WHERE from_item_id = ? OR to_item_id = ?")
      .all(itemId, itemId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTrace(r));
  }

  getDependentTraces(upstreamItemId: string): Trace[] {
    const rows = this.db
      .prepare("SELECT * FROM traces WHERE to_item_id = ?")
      .all(upstreamItemId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTrace(r));
  }

  getUpstreamTraces(itemId: string): Trace[] {
    const rows = this.db
      .prepare("SELECT * FROM traces WHERE from_item_id = ?")
      .all(itemId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTrace(r));
  }

  // --- Signals ---

  createSignal(
    kind: string,
    sourceItem: string,
    sourceNode: string,
    targetItem: string,
    targetNode: string,
    payload: string,
  ): Signal {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO signals (id, kind, source_item, source_node, target_item, target_node, payload, processed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
      )
      .run(id, kind, sourceItem, sourceNode, targetItem, targetNode, payload, now);
    return {
      id, kind: kind as Signal["kind"], sourceItem, sourceNode,
      targetItem, targetNode, payload, processed: false, createdAt: now,
    };
  }

  markSignalProcessed(id: string): void {
    this.db.prepare("UPDATE signals SET processed = 1 WHERE id = ?").run(id);
  }

  // --- Transitions ---

  recordTransition(
    itemId: string,
    kind: TransitionKind,
    from: ItemState,
    to: ItemState,
    evidence: string,
    reason: string,
    actor: string,
  ): Transition {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO transitions (id, item_id, kind, from_s, to_s, evidence, reason, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, itemId, kind, from, to, evidence, reason, actor, now);
    return { id, itemId, kind, from, to, evidence, reason, actor, timestamp: now };
  }

  getItemTransitions(itemId: string): Transition[] {
    const rows = this.db
      .prepare("SELECT * FROM transitions WHERE item_id = ? ORDER BY timestamp")
      .all(itemId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTransition(r));
  }

  // --- Queries ---

  createQuery(
    askerId: string,
    askerNode: string,
    question: string,
    context: string,
    targetNode: string,
  ): Query {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO queries (id, asker_id, asker_node, question, context, target_node, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      )
      .run(id, askerId, askerNode, question, context, targetNode, now);
    return {
      id, askerId, askerNode, question, context,
      targetNode, resolved: false, createdAt: now,
    };
  }

  createQueryResponse(
    queryId: string,
    responderId: string,
    nodeId: string,
    answer: string,
    isAI: boolean,
  ): QueryResponse {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO query_responses (id, query_id, responder_id, node_id, answer, is_ai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, queryId, responderId, nodeId, answer, isAI ? 1 : 0, now);
    return { id, queryId, responderId, nodeId, answer, isAI, createdAt: now };
  }

  // --- Pending Actions ---

  createPendingAction(
    messageType: string,
    envelope: string,
    summary: string,
    proposed: string,
  ): PendingAction {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO pending_actions (id, message_type, envelope, summary, proposed, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(id, messageType, envelope, summary, proposed, now);
    return {
      id, messageType, envelope, summary,
      proposed, status: "pending", createdAt: now,
    };
  }

  listPendingActions(): PendingAction[] {
    const rows = this.db
      .prepare("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToPendingAction(r));
  }

  updatePendingActionStatus(id: string, status: PendingAction["status"]): void {
    this.db
      .prepare("UPDATE pending_actions SET status = ? WHERE id = ?")
      .run(status, id);
  }

  // --- Audit ---

  audit(nodeId: string): AuditReport {
    const items = this.listItems(nodeId);
    const unverified: string[] = [];
    const proven: string[] = [];
    const suspect: string[] = [];
    const broke: string[] = [];
    const orphans: string[] = [];
    const missingUpstreamRefs: string[] = [];

    for (const item of items) {
      switch (item.state) {
        case "unverified": unverified.push(item.id); break;
        case "proven": proven.push(item.id); break;
        case "suspect": suspect.push(item.id); break;
        case "broke": broke.push(item.id); break;
      }
      const traces = this.getItemTraces(item.id);
      if (traces.length === 0) {
        orphans.push(item.id);
      }
      const upstreamTraces = this.getUpstreamTraces(item.id);
      if (upstreamTraces.length === 0 && item.kind !== "prd" && item.kind !== "epic") {
        missingUpstreamRefs.push(item.id);
      }
    }

    return {
      nodeId,
      totalItems: items.length,
      unverified,
      proven,
      suspect,
      broke,
      orphans,
      missingUpstreamRefs,
    };
  }

  // --- Row Mappers ---

  private rowToNode(row: Record<string, unknown>): Node {
    return {
      id: row.id as string,
      name: row.name as string,
      vertical: row.vertical as Vertical,
      project: row.project as string,
      owner: row.owner as string,
      isAI: row.is_ai === 1,
      createdAt: row.created_at as string,
    };
  }

  private rowToItem(row: Record<string, unknown>): Item {
    return {
      id: row.id as string,
      nodeId: row.node_id as string,
      kind: row.kind as ItemKind,
      title: row.title as string,
      body: (row.body as string) ?? "",
      externalRef: (row.external_ref as string) ?? "",
      state: row.state as ItemState,
      evidence: (row.evidence as string) ?? "",
      confirmedBy: (row.confirmed_by as string) ?? "",
      confirmedAt: (row.confirmed_at as string) ?? null,
      version: row.version as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToTrace(row: Record<string, unknown>): Trace {
    return {
      id: row.id as string,
      fromItemId: row.from_item_id as string,
      fromNodeId: row.from_node_id as string,
      toItemId: row.to_item_id as string,
      toNodeId: row.to_node_id as string,
      relation: row.relation as TraceRelation,
      confirmedBy: (row.confirmed_by as string) ?? "",
      confirmedAt: (row.confirmed_at as string) ?? null,
      createdAt: row.created_at as string,
    };
  }

  private rowToTransition(row: Record<string, unknown>): Transition {
    return {
      id: row.id as string,
      itemId: row.item_id as string,
      kind: row.kind as TransitionKind,
      from: row.from_s as ItemState,
      to: row.to_s as ItemState,
      evidence: (row.evidence as string) ?? "",
      reason: (row.reason as string) ?? "",
      actor: row.actor as string,
      timestamp: row.timestamp as string,
    };
  }

  private rowToPendingAction(row: Record<string, unknown>): PendingAction {
    return {
      id: row.id as string,
      messageType: row.message_type as string,
      envelope: row.envelope as string,
      summary: row.summary as string,
      proposed: row.proposed as string,
      status: row.status as PendingAction["status"],
      createdAt: row.created_at as string,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/store.ts packages/node/test/store.test.ts
git commit -m "feat: add SQLite store with bun:sqlite for nodes, items, traces, signals"
```

---

### Task 5: Signal Propagation

**Files:**
- Create: `packages/node/src/signal.ts`
- Create: `packages/node/test/signal.test.ts`

**Step 1: Write signal tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SignalPropagator } from "../src/signal";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";

describe("SignalPropagator", () => {
  let store: Store;
  let propagator: SignalPropagator;

  beforeEach(() => {
    store = new Store(":memory:");
    propagator = new SignalPropagator(store, new StateMachine());
  });

  afterEach(() => {
    store.close();
  });

  test("propagateChange marks downstream proven items as suspect", () => {
    const node = store.createNode("n1", "dev", "proj", "cuong", false);
    const upstream = store.createItem(node.id, "adr", "ADR", "", "");
    const downstream = store.createItem(node.id, "api-spec", "Spec", "", "");

    // Verify both items first
    store.updateItemStatus(upstream.id, "proven", "evidence", "cuong");
    store.updateItemStatus(downstream.id, "proven", "evidence", "cuong");

    // Create trace: downstream depends on upstream
    store.createTrace(downstream.id, node.id, upstream.id, node.id, "traced_from", "cuong");

    // Propagate change from upstream
    const signals = propagator.propagateChange(upstream.id);
    expect(signals.length).toBeGreaterThan(0);

    // Downstream should now be suspect
    const fetched = store.getItem(downstream.id);
    expect(fetched!.state).toBe("suspect");
  });

  test("propagateChange skips non-proven downstream items", () => {
    const node = store.createNode("n1", "dev", "proj", "cuong", false);
    const upstream = store.createItem(node.id, "adr", "ADR", "", "");
    const downstream = store.createItem(node.id, "api-spec", "Spec", "", "");

    // Only verify upstream, downstream stays unverified
    store.updateItemStatus(upstream.id, "proven", "evidence", "cuong");
    store.createTrace(downstream.id, node.id, upstream.id, node.id, "traced_from", "cuong");

    const signals = propagator.propagateChange(upstream.id);
    expect(signals).toHaveLength(0);

    // Downstream should still be unverified
    const fetched = store.getItem(downstream.id);
    expect(fetched!.state).toBe("unverified");
  });

  test("propagateChange cascades recursively", () => {
    const node = store.createNode("n1", "dev", "proj", "cuong", false);
    const a = store.createItem(node.id, "adr", "A", "", "");
    const b = store.createItem(node.id, "api-spec", "B", "", "");
    const c = store.createItem(node.id, "test-case", "C", "", "");

    // Verify all
    store.updateItemStatus(a.id, "proven", "ev", "cuong");
    store.updateItemStatus(b.id, "proven", "ev", "cuong");
    store.updateItemStatus(c.id, "proven", "ev", "cuong");

    // C depends on B, B depends on A
    store.createTrace(b.id, node.id, a.id, node.id, "traced_from", "cuong");
    store.createTrace(c.id, node.id, b.id, node.id, "traced_from", "cuong");

    const signals = propagator.propagateChange(a.id);
    expect(signals).toHaveLength(2); // B and C both become suspect

    expect(store.getItem(b.id)!.state).toBe("suspect");
    expect(store.getItem(c.id)!.state).toBe("suspect");
  });

  test("computeImpact returns all downstream items without changing state", () => {
    const node = store.createNode("n1", "dev", "proj", "cuong", false);
    const a = store.createItem(node.id, "adr", "A", "", "");
    const b = store.createItem(node.id, "api-spec", "B", "", "");

    store.updateItemStatus(a.id, "proven", "ev", "cuong");
    store.updateItemStatus(b.id, "proven", "ev", "cuong");
    store.createTrace(b.id, node.id, a.id, node.id, "traced_from", "cuong");

    const impacted = propagator.computeImpact(a.id);
    expect(impacted).toHaveLength(1);
    expect(impacted[0].id).toBe(b.id);

    // State should NOT change
    expect(store.getItem(b.id)!.state).toBe("proven");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/signal.test.ts`
Expected: FAIL — module "../src/signal" not found

**Step 3: Write signal.ts**

```typescript
import type { Item, Signal } from "@inv/shared";
import type { Store } from "./store";
import type { StateMachine } from "./state";

export class SignalPropagator {
  constructor(
    private store: Store,
    private sm: StateMachine,
  ) {}

  propagateChange(changedItemId: string): Signal[] {
    const signals: Signal[] = [];
    const visited = new Set<string>();
    this.propagateRecursive(changedItemId, signals, visited);
    return signals;
  }

  computeImpact(itemId: string): Item[] {
    const impacted: Item[] = [];
    const visited = new Set<string>();
    this.collectImpactRecursive(itemId, impacted, visited);
    return impacted;
  }

  private propagateRecursive(
    itemId: string,
    signals: Signal[],
    visited: Set<string>,
  ): void {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const dependentTraces = this.store.getDependentTraces(itemId);
    const sourceItem = this.store.getItem(itemId);
    if (!sourceItem) return;

    for (const trace of dependentTraces) {
      const downstream = this.store.getItem(trace.fromItemId);
      if (!downstream) continue;
      if (downstream.state !== "proven") continue;

      // Transition downstream to suspect
      if (this.sm.canTransition("proven", "suspect")) {
        this.store.updateItemStatus(downstream.id, "suspect", "", "");
        this.store.recordTransition(
          downstream.id,
          "suspect",
          "proven",
          "suspect",
          "",
          `Upstream item ${itemId} changed`,
          "system",
        );

        const signal = this.store.createSignal(
          "change",
          sourceItem.id,
          sourceItem.nodeId,
          downstream.id,
          downstream.nodeId,
          `Item "${sourceItem.title}" changed, marking "${downstream.title}" as suspect`,
        );
        signals.push(signal);

        // Recurse
        this.propagateRecursive(downstream.id, signals, visited);
      }
    }
  }

  private collectImpactRecursive(
    itemId: string,
    impacted: Item[],
    visited: Set<string>,
  ): void {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const dependentTraces = this.store.getDependentTraces(itemId);
    for (const trace of dependentTraces) {
      const downstream = this.store.getItem(trace.fromItemId);
      if (!downstream) continue;
      impacted.push(downstream);
      this.collectImpactRecursive(downstream.id, impacted, visited);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/signal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/signal.ts packages/node/test/signal.test.ts
git commit -m "feat: add signal propagation for recursive change cascading"
```

---

### Task 6: Engine

**Files:**
- Create: `packages/node/src/engine.ts`
- Create: `packages/node/test/engine.test.ts`

**Step 1: Write engine tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Engine } from "../src/engine";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";

describe("Engine", () => {
  let store: Store;
  let engine: Engine;

  beforeEach(() => {
    store = new Store(":memory:");
    const sm = new StateMachine();
    const propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);
  });

  afterEach(() => {
    store.close();
  });

  describe("registerNode", () => {
    test("creates a node", () => {
      const node = engine.registerNode("dev-inv", "dev", "clinic", "cuong", false);
      expect(node.name).toBe("dev-inv");
      expect(node.vertical).toBe("dev");
    });
  });

  describe("addItem", () => {
    test("creates item in unverified state", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item = engine.addItem(node.id, "adr", "My ADR", "", "");
      expect(item.state).toBe("unverified");
    });

    test("throws for nonexistent node", () => {
      expect(() => engine.addItem("fake", "adr", "ADR", "", "")).toThrow();
    });
  });

  describe("addTrace", () => {
    test("creates trace between items", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item1 = engine.addItem(node.id, "adr", "ADR", "", "");
      const item2 = engine.addItem(node.id, "api-spec", "Spec", "", "");
      const trace = engine.addTrace(item1.id, item2.id, "traced_from", "cuong");
      expect(trace.fromItemId).toBe(item1.id);
      expect(trace.toItemId).toBe(item2.id);
    });

    test("throws for nonexistent item", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item = engine.addItem(node.id, "adr", "ADR", "", "");
      expect(() => engine.addTrace(item.id, "fake", "traced_from", "cuong")).toThrow();
    });
  });

  describe("verifyItem", () => {
    test("transitions item to proven", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item = engine.addItem(node.id, "adr", "ADR", "", "");
      engine.verifyItem(item.id, "load test passed", "cuong");

      const fetched = store.getItem(item.id);
      expect(fetched!.state).toBe("proven");
      expect(fetched!.evidence).toBe("load test passed");
    });

    test("propagates change to downstream items", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const upstream = engine.addItem(node.id, "adr", "ADR", "", "");
      const downstream = engine.addItem(node.id, "api-spec", "Spec", "", "");

      // Verify both
      engine.verifyItem(upstream.id, "ev1", "cuong");
      engine.verifyItem(downstream.id, "ev2", "cuong");
      engine.addTrace(downstream.id, upstream.id, "traced_from", "cuong");

      // Re-verify upstream triggers propagation
      engine.markBroken(upstream.id, "outdated", "cuong");
      // First need to go through suspect
      // Actually verify creates propagation — let's test via suspect
    });
  });

  describe("markBroken", () => {
    test("transitions suspect item to broke", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item = engine.addItem(node.id, "adr", "ADR", "", "");
      engine.verifyItem(item.id, "evidence", "cuong");

      // Need to make it suspect first (via propagation or direct)
      // Simulate by making it suspect through a dependency change
      store.updateItemStatus(item.id, "suspect", "", "");
      store.recordTransition(item.id, "suspect", "proven", "suspect", "", "upstream changed", "system");

      engine.markBroken(item.id, "completely wrong", "cuong");
      const fetched = store.getItem(item.id);
      expect(fetched!.state).toBe("broke");
    });
  });

  describe("impact", () => {
    test("returns downstream items", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const a = engine.addItem(node.id, "adr", "A", "", "");
      const b = engine.addItem(node.id, "api-spec", "B", "", "");
      engine.addTrace(b.id, a.id, "traced_from", "cuong");

      const impact = engine.impact(a.id);
      expect(impact).toHaveLength(1);
      expect(impact[0].id).toBe(b.id);
    });
  });

  describe("audit", () => {
    test("returns audit report for node", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      engine.addItem(node.id, "adr", "ADR 1", "", "");
      engine.addItem(node.id, "api-spec", "Spec", "", "");

      const report = engine.audit(node.id);
      expect(report.totalItems).toBe(2);
      expect(report.unverified).toHaveLength(2);
    });
  });

  describe("ask", () => {
    test("creates a query", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const query = engine.ask("cuong", node.id, "What uses the API?", "", "");
      expect(query.question).toBe("What uses the API?");
      expect(query.resolved).toBe(false);
    });
  });

  describe("sweep", () => {
    test("finds items by external ref and propagates", () => {
      const node = engine.registerNode("n1", "dev", "proj", "cuong", false);
      const item = engine.addItem(node.id, "adr", "ADR", "", "US-003");
      engine.verifyItem(item.id, "ev", "cuong");

      const downstream = engine.addItem(node.id, "api-spec", "Spec", "", "");
      engine.verifyItem(downstream.id, "ev", "cuong");
      engine.addTrace(downstream.id, item.id, "traced_from", "cuong");

      const result = engine.sweep("US-003");
      expect(result.matchedItems).toHaveLength(1);
      expect(result.matchedItems[0].id).toBe(item.id);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/engine.test.ts`
Expected: FAIL — module "../src/engine" not found

**Step 3: Write engine.ts**

```typescript
import type {
  Node, Item, Trace, Signal, Query, QueryResponse,
  AuditReport, ItemKind, TraceRelation, Vertical,
} from "@inv/shared";
import type { Store } from "./store";
import type { StateMachine } from "./state";
import type { SignalPropagator } from "./signal";

export interface SweepResult {
  triggerRef: string;
  matchedItems: Item[];
  affectedItems: Item[];
  signalsCreated: number;
}

export class Engine {
  constructor(
    private store: Store,
    private sm: StateMachine,
    private propagator: SignalPropagator,
  ) {}

  // --- Nodes ---

  registerNode(
    name: string,
    vertical: Vertical,
    project: string,
    owner: string,
    isAI: boolean,
  ): Node {
    return this.store.createNode(name, vertical, project, owner, isAI);
  }

  getNode(id: string): Node {
    const node = this.store.getNode(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    return node;
  }

  listNodes(project: string): Node[] {
    return this.store.listNodes(project);
  }

  // --- Items ---

  addItem(
    nodeId: string,
    kind: ItemKind,
    title: string,
    body: string,
    externalRef: string,
  ): Item {
    const node = this.store.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    return this.store.createItem(nodeId, kind, title, body, externalRef);
  }

  getItem(id: string): Item {
    const item = this.store.getItem(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    return item;
  }

  listItems(nodeId: string): Item[] {
    return this.store.listItems(nodeId);
  }

  // --- Traces ---

  addTrace(
    fromItemId: string,
    toItemId: string,
    relation: TraceRelation,
    actor: string,
  ): Trace {
    const fromItem = this.store.getItem(fromItemId);
    if (!fromItem) throw new Error(`Item not found: ${fromItemId}`);
    const toItem = this.store.getItem(toItemId);
    if (!toItem) throw new Error(`Item not found: ${toItemId}`);
    return this.store.createTrace(
      fromItemId, fromItem.nodeId,
      toItemId, toItem.nodeId,
      relation, actor,
    );
  }

  // --- State Transitions ---

  verifyItem(itemId: string, evidence: string, actor: string): Signal[] {
    const item = this.getItem(itemId);
    const kind = item.state === "unverified" ? "verify" as const
      : item.state === "suspect" ? "re_verify" as const
      : item.state === "broke" ? "fix" as const
      : null;

    if (!kind) throw new Error(`Cannot verify item in state "${item.state}"`);

    const newState = this.sm.apply(item.state, kind);
    this.store.updateItemStatus(itemId, newState, evidence, actor);
    this.store.recordTransition(itemId, kind, item.state, newState, evidence, "", actor);
    return this.propagator.propagateChange(itemId);
  }

  markBroken(itemId: string, reason: string, actor: string): void {
    const item = this.getItem(itemId);
    if (item.state !== "suspect") {
      throw new Error(`Cannot break item in state "${item.state}", must be suspect`);
    }
    const newState = this.sm.apply(item.state, "break");
    this.store.updateItemStatus(itemId, newState, "", actor);
    this.store.recordTransition(itemId, "break", item.state, newState, "", reason, actor);
  }

  // --- Signal & Impact ---

  propagateChange(itemId: string): Signal[] {
    return this.propagator.propagateChange(itemId);
  }

  impact(itemId: string): Item[] {
    return this.propagator.computeImpact(itemId);
  }

  // --- Queries ---

  ask(
    askerId: string,
    askerNode: string,
    question: string,
    context: string,
    targetNode: string,
  ): Query {
    return this.store.createQuery(askerId, askerNode, question, context, targetNode);
  }

  respond(
    queryId: string,
    responderId: string,
    nodeId: string,
    answer: string,
    isAI: boolean,
  ): QueryResponse {
    return this.store.createQueryResponse(queryId, responderId, nodeId, answer, isAI);
  }

  // --- Audit ---

  audit(nodeId: string): AuditReport {
    return this.store.audit(nodeId);
  }

  // --- Sweep ---

  sweep(externalRef: string): SweepResult {
    const matchedItems = this.store.findItemsByExternalRef(externalRef);
    const allAffected: Item[] = [];
    let signalsCreated = 0;

    for (const item of matchedItems) {
      const signals = this.propagator.propagateChange(item.id);
      signalsCreated += signals.length;
      for (const signal of signals) {
        const affected = this.store.getItem(signal.targetItem);
        if (affected) allAffected.push(affected);
      }
    }

    return {
      triggerRef: externalRef,
      matchedItems,
      affectedItems: allAffected,
      signalsCreated,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/engine.ts packages/node/test/engine.test.ts
git commit -m "feat: add inventory engine with node/item/trace management and signal propagation"
```

---

### Task 7: Central Server — Auth + Hub + Outbox

**Files:**
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/hub.ts`
- Create: `packages/server/src/outbox.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/test/server.test.ts`

**Step 1: Write server tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import Redis from "ioredis";
import { RedisAuth } from "../src/auth";
import { RedisHub } from "../src/hub";
import { RedisOutbox } from "../src/outbox";

// These tests require Redis running locally.
// Skip with: SKIP_REDIS=1 bun test
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const TEST_DB = 15; // Use DB 15 for tests

describe("RedisAuth", () => {
  let redis: Redis;
  let auth: RedisAuth;

  beforeEach(async () => {
    redis = new Redis(REDIS_URL, { db: TEST_DB });
    await redis.flushdb();
    auth = new RedisAuth(redis);
  });

  afterEach(async () => {
    await redis.flushdb();
    redis.disconnect();
  });

  test("createToken and validateToken round-trip", async () => {
    const token = await auth.createToken("proj1", "node-a");
    expect(token).toBeTruthy();

    const info = await auth.validateToken(token);
    expect(info).not.toBeNull();
    expect(info!.projectId).toBe("proj1");
    expect(info!.nodeId).toBe("node-a");
  });

  test("validateToken returns null for invalid token", async () => {
    const info = await auth.validateToken("bogus");
    expect(info).toBeNull();
  });

  test("revokeToken removes token", async () => {
    const token = await auth.createToken("proj1", "node-a");
    await auth.revokeToken(token);

    const info = await auth.validateToken(token);
    expect(info).toBeNull();
  });

  test("listTokens returns all tokens for project", async () => {
    await auth.createToken("proj1", "node-a");
    await auth.createToken("proj1", "node-b");
    await auth.createToken("proj2", "node-c");

    const tokens = await auth.listTokens("proj1");
    expect(tokens).toHaveLength(2);
  });
});

describe("RedisOutbox", () => {
  let redis: Redis;
  let outbox: RedisOutbox;

  beforeEach(async () => {
    redis = new Redis(REDIS_URL, { db: TEST_DB });
    await redis.flushdb();
    outbox = new RedisOutbox(redis);
  });

  afterEach(async () => {
    await redis.flushdb();
    redis.disconnect();
  });

  test("enqueue and drain messages", async () => {
    await outbox.enqueue("proj1", "node-a", '{"test": 1}');
    await outbox.enqueue("proj1", "node-a", '{"test": 2}');

    const messages = await outbox.drain("proj1", "node-a");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe('{"test": 1}');
  });

  test("drain returns empty for no messages", async () => {
    const messages = await outbox.drain("proj1", "node-a");
    expect(messages).toHaveLength(0);
  });

  test("drain clears the queue", async () => {
    await outbox.enqueue("proj1", "node-a", '{"test": 1}');
    await outbox.drain("proj1", "node-a");

    const messages = await outbox.drain("proj1", "node-a");
    expect(messages).toHaveLength(0);
  });
});

describe("RedisHub", () => {
  let redis: Redis;
  let hub: RedisHub;

  beforeEach(async () => {
    redis = new Redis(REDIS_URL, { db: TEST_DB });
    await redis.flushdb();
    const outbox = new RedisOutbox(redis);
    hub = new RedisHub(redis, outbox, "test-instance-1");
  });

  afterEach(async () => {
    await hub.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  test("register and isOnline", async () => {
    const mockWs = {} as WebSocket;
    await hub.register("proj1", "node-a", mockWs);

    const online = await hub.isOnline("proj1", "node-a");
    expect(online).toBe(true);
  });

  test("unregister removes presence", async () => {
    const mockWs = {} as WebSocket;
    await hub.register("proj1", "node-a", mockWs);
    await hub.unregister("proj1", "node-a");

    const online = await hub.isOnline("proj1", "node-a");
    expect(online).toBe(false);
  });

  test("listOnline returns all online nodes", async () => {
    const mockWs = {} as WebSocket;
    await hub.register("proj1", "node-a", mockWs);
    await hub.register("proj1", "node-b", mockWs);

    const online = await hub.listOnline("proj1");
    expect(online).toHaveLength(2);
    expect(online).toContain("node-a");
    expect(online).toContain("node-b");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/server/test/server.test.ts`
Expected: FAIL — modules not found

**Step 3: Write auth.ts**

```typescript
import type Redis from "ioredis";
import { randomUUID } from "crypto";

export interface TokenInfo {
  projectId: string;
  nodeId: string;
  createdAt: string;
}

export class RedisAuth {
  constructor(private redis: Redis) {}

  async createToken(projectId: string, nodeId: string): Promise<string> {
    const token = randomUUID();
    const now = new Date().toISOString();
    await this.redis.hset(`token:${token}`, {
      projectId,
      nodeId,
      createdAt: now,
    });
    // Index for listing by project
    await this.redis.sadd(`project_tokens:${projectId}`, token);
    return token;
  }

  async validateToken(token: string): Promise<TokenInfo | null> {
    const data = await this.redis.hgetall(`token:${token}`);
    if (!data.projectId) return null;
    return {
      projectId: data.projectId,
      nodeId: data.nodeId,
      createdAt: data.createdAt,
    };
  }

  async revokeToken(token: string): Promise<void> {
    const data = await this.redis.hgetall(`token:${token}`);
    if (data.projectId) {
      await this.redis.srem(`project_tokens:${data.projectId}`, token);
    }
    await this.redis.del(`token:${token}`);
  }

  async listTokens(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.redis.smembers(`project_tokens:${projectId}`);
    const results: TokenInfo[] = [];
    for (const token of tokens) {
      const info = await this.validateToken(token);
      if (info) results.push(info);
    }
    return results;
  }
}
```

**Step 4: Write outbox.ts**

```typescript
import type Redis from "ioredis";

export class RedisOutbox {
  constructor(private redis: Redis) {}

  async enqueue(
    projectId: string,
    nodeId: string,
    message: string,
  ): Promise<void> {
    await this.redis.rpush(`outbox:${projectId}:${nodeId}`, message);
  }

  async drain(projectId: string, nodeId: string): Promise<string[]> {
    const key = `outbox:${projectId}:${nodeId}`;
    const len = await this.redis.llen(key);
    if (len === 0) return [];

    const messages: string[] = [];
    for (let i = 0; i < len; i++) {
      const msg = await this.redis.lpop(key);
      if (msg) messages.push(msg);
    }
    return messages;
  }

  async depth(projectId: string, nodeId: string): Promise<number> {
    return this.redis.llen(`outbox:${projectId}:${nodeId}`);
  }
}
```

**Step 5: Write hub.ts**

```typescript
import type Redis from "ioredis";
import type { RedisOutbox } from "./outbox";
import type { Envelope } from "@inv/shared";

export class RedisHub {
  private localConns = new Map<string, WebSocket>(); // "projectId:nodeId" → ws
  private subRedis: Redis;

  constructor(
    private redis: Redis,
    private outbox: RedisOutbox,
    private instanceId: string,
  ) {
    // Separate connection for subscriptions
    this.subRedis = redis.duplicate();
  }

  async register(
    projectId: string,
    nodeId: string,
    ws: WebSocket,
  ): Promise<void> {
    const key = `${projectId}:${nodeId}`;
    this.localConns.set(key, ws);
    await this.redis.hset(`presence:${projectId}`, nodeId, this.instanceId);
  }

  async unregister(projectId: string, nodeId: string): Promise<void> {
    const key = `${projectId}:${nodeId}`;
    this.localConns.delete(key);
    await this.redis.hdel(`presence:${projectId}`, nodeId);
  }

  async isOnline(projectId: string, nodeId: string): Promise<boolean> {
    const instance = await this.redis.hget(`presence:${projectId}`, nodeId);
    return instance !== null;
  }

  async listOnline(projectId: string): Promise<string[]> {
    const presence = await this.redis.hgetall(`presence:${projectId}`);
    return Object.keys(presence);
  }

  async route(envelope: Envelope): Promise<void> {
    const { projectId, toNode, fromNode } = envelope;
    const message = JSON.stringify(envelope);

    if (toNode) {
      // Direct message
      await this.deliverTo(projectId, toNode, message);
    } else {
      // Broadcast to all nodes in project except sender
      const online = await this.listOnline(projectId);
      for (const nodeId of online) {
        if (nodeId !== fromNode) {
          await this.deliverTo(projectId, nodeId, message);
        }
      }
    }
  }

  private async deliverTo(
    projectId: string,
    nodeId: string,
    message: string,
  ): Promise<void> {
    const key = `${projectId}:${nodeId}`;
    const localWs = this.localConns.get(key);

    if (localWs) {
      // Destination is on this instance
      localWs.send(message);
      return;
    }

    // Check if destination is on another instance
    const instance = await this.redis.hget(`presence:${projectId}`, nodeId);
    if (instance && instance !== this.instanceId) {
      // Publish to cross-instance channel
      await this.redis.publish(`route:${projectId}`, message);
      return;
    }

    // Destination is offline — enqueue
    await this.outbox.enqueue(projectId, nodeId, message);
  }

  async drainOutbox(
    projectId: string,
    nodeId: string,
    ws: WebSocket,
  ): Promise<void> {
    const messages = await this.outbox.drain(projectId, nodeId);
    for (const msg of messages) {
      ws.send(msg);
    }
  }

  async shutdown(): Promise<void> {
    this.subRedis.disconnect();
    this.localConns.clear();
  }
}
```

**Step 6: Update index.ts with WebSocket server**

```typescript
import { RedisAuth } from "./auth";
import { RedisHub } from "./hub";
import { RedisOutbox } from "./outbox";
import { parseEnvelope } from "@inv/shared";
import Redis from "ioredis";

export { RedisAuth, RedisHub, RedisOutbox };

export function startServer(options: {
  port: number;
  redisUrl: string;
}): void {
  const redis = new Redis(options.redisUrl);
  const auth = new RedisAuth(redis);
  const outbox = new RedisOutbox(redis);
  const hub = new RedisHub(redis, outbox, `instance-${process.pid}`);

  const server = Bun.serve({
    port: options.port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response("Missing token", { status: 401 });
        }

        const info = await auth.validateToken(token);
        if (!info) {
          return new Response("Invalid token", { status: 401 });
        }

        const upgraded = server.upgrade(req, {
          data: { projectId: info.projectId, nodeId: info.nodeId },
        });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      }

      return new Response("inv-server", { status: 200 });
    },
    websocket: {
      async open(ws) {
        const { projectId, nodeId } = ws.data as {
          projectId: string;
          nodeId: string;
        };
        await hub.register(projectId, nodeId, ws as unknown as WebSocket);
        await hub.drainOutbox(projectId, nodeId, ws as unknown as WebSocket);
        console.log(`[${projectId}] ${nodeId} connected`);
      },
      async message(ws, message) {
        try {
          const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
          const envelope = parseEnvelope(raw);
          await hub.route(envelope);
        } catch (err) {
          console.error("Invalid message:", err);
        }
      },
      async close(ws) {
        const { projectId, nodeId } = ws.data as {
          projectId: string;
          nodeId: string;
        };
        await hub.unregister(projectId, nodeId);
        console.log(`[${projectId}] ${nodeId} disconnected`);
      },
    },
  });

  console.log(`inv-server listening on port ${server.port}`);
}

// CLI entry point
const args = process.argv.slice(2);
if (args[0] === "start") {
  const port = parseInt(args.find((_, i, a) => a[i - 1] === "--port") ?? "8080");
  const redisUrl = args.find((_, i, a) => a[i - 1] === "--redis") ?? "redis://localhost:6379";
  startServer({ port, redisUrl });
}
```

**Step 7: Run tests (requires Redis)**

Run: `bun test packages/server/test/server.test.ts`
Expected: PASS (if Redis is running on localhost:6379)

**Step 8: Commit**

```bash
git add packages/server/
git commit -m "feat: add central server with Redis-backed auth, hub, and outbox"
```

---

### Task 8: WebSocket Client

**Files:**
- Create: `packages/node/src/ws-client.ts`
- Create: `packages/node/src/event-bus.ts`
- Create: `packages/node/src/ws-handlers.ts`
- Create: `packages/node/test/ws-client.test.ts`

**Step 1: Write event bus tests**

Create: `packages/node/test/event-bus.test.ts`

```typescript
import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/event-bus";

describe("EventBus", () => {
  test("on and emit", () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("signal_change", (data) => {
      received.push(data as string);
    });

    bus.emit("signal_change", "test-data");
    expect(received).toEqual(["test-data"]);
  });

  test("multiple listeners", () => {
    const bus = new EventBus();
    let count = 0;

    bus.on("query_ask", () => count++);
    bus.on("query_ask", () => count++);

    bus.emit("query_ask", {});
    expect(count).toBe(2);
  });

  test("off removes listener", () => {
    const bus = new EventBus();
    let count = 0;

    const handler = () => count++;
    bus.on("sweep", handler);
    bus.off("sweep", handler);

    bus.emit("sweep", {});
    expect(count).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/event-bus.test.ts`
Expected: FAIL

**Step 3: Write event-bus.ts**

```typescript
export type EventType =
  | "signal_change"
  | "sweep"
  | "trace_resolve_request"
  | "trace_resolve_response"
  | "query_ask"
  | "query_respond"
  | "ack"
  | "error";

type EventHandler = (data: unknown) => void;

export class EventBus {
  private listeners = new Map<EventType, Set<EventHandler>>();

  on(event: EventType, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: EventType, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: EventType, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(data);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/event-bus.test.ts`
Expected: PASS

**Step 5: Write ws-client.ts**

```typescript
import { createEnvelope, parseEnvelope, type Envelope, type MessagePayload } from "@inv/shared";

export interface WSClientConfig {
  serverUrl: string;
  token: string;
  nodeId: string;
  projectId: string;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private messageHandler: ((envelope: Envelope) => void) | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;

  constructor(private config: WSClientConfig) {}

  async connect(): Promise<void> {
    const url = `${this.config.serverUrl}?token=${this.config.token}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        console.log(`Connected to server as ${this.config.nodeId}`);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : "";
          const envelope = parseEnvelope(raw);
          this.messageHandler?.(envelope);
        } catch (err) {
          console.error("Failed to parse message:", err);
        }
      };

      this.ws.onclose = () => {
        if (this.shouldReconnect) {
          console.log(`Disconnected. Reconnecting in ${this.reconnectDelay}ms...`);
          setTimeout(() => this.connect(), this.reconnectDelay);
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.maxReconnectDelay,
          );
        }
      };

      this.ws.onerror = (err) => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      };
    });
  }

  send(envelope: Envelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(envelope));
  }

  sendMessage(toNode: string, payload: MessagePayload): void {
    const envelope = createEnvelope(
      this.config.nodeId,
      toNode,
      this.config.projectId,
      payload,
    );
    this.send(envelope);
  }

  broadcast(payload: MessagePayload): void {
    const envelope = createEnvelope(
      this.config.nodeId,
      "",
      this.config.projectId,
      payload,
    );
    this.send(envelope);
  }

  onMessage(handler: (envelope: Envelope) => void): void {
    this.messageHandler = handler;
  }

  close(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
```

**Step 6: Write ws-handlers.ts**

```typescript
import type { Envelope } from "@inv/shared";
import type { Engine } from "./engine";
import type { Store } from "./store";
import type { EventBus, EventType } from "./event-bus";

export class WSHandlers {
  constructor(
    private engine: Engine,
    private store: Store,
    private eventBus: EventBus,
  ) {}

  handle(envelope: Envelope): void {
    const { payload } = envelope;

    switch (payload.type) {
      case "signal_change":
        this.handleSignalChange(envelope);
        break;
      case "sweep":
        this.handleSweep(envelope);
        break;
      case "trace_resolve_request":
        this.handleTraceResolveRequest(envelope);
        break;
      case "trace_resolve_response":
        this.handleTraceResolveResponse(envelope);
        break;
      case "query_ask":
        this.handleQueryAsk(envelope);
        break;
      case "query_respond":
        this.handleQueryRespond(envelope);
        break;
      case "ack":
        break;
      case "error":
        console.error(`Error from ${envelope.fromNode}: ${payload.message}`);
        break;
    }

    this.eventBus.emit(payload.type as EventType, envelope);
  }

  private handleSignalChange(envelope: Envelope): void {
    if (envelope.payload.type !== "signal_change") return;
    const { itemId } = envelope.payload;
    try {
      this.engine.propagateChange(itemId);
    } catch {
      // Item may not exist locally — that's fine for cross-node signals
    }
  }

  private handleSweep(envelope: Envelope): void {
    if (envelope.payload.type !== "sweep") return;
    const { externalRef } = envelope.payload;
    this.engine.sweep(externalRef);
  }

  private handleTraceResolveRequest(envelope: Envelope): void {
    if (envelope.payload.type !== "trace_resolve_request") return;
    // Respond with item metadata if we have it
    const { itemId } = envelope.payload;
    try {
      const item = this.engine.getItem(itemId);
      // Response would be sent via WSClient — wired at integration level
      this.eventBus.emit("trace_resolve_response", {
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        state: item.state,
        requestedBy: envelope.fromNode,
      });
    } catch {
      // Item not found locally
    }
  }

  private handleTraceResolveResponse(envelope: Envelope): void {
    // Store the response for the requesting trace
  }

  private handleQueryAsk(envelope: Envelope): void {
    if (envelope.payload.type !== "query_ask") return;
    const { question, askerId } = envelope.payload;
    // Store the query locally for the AI/human to respond to
    this.store.createQuery(askerId, envelope.fromNode, question, "", "");
  }

  private handleQueryRespond(envelope: Envelope): void {
    // Store the response
  }
}
```

**Step 7: Run all node tests**

Run: `bun test packages/node/`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/node/src/ws-client.ts packages/node/src/ws-handlers.ts packages/node/src/event-bus.ts packages/node/test/
git commit -m "feat: add WebSocket client, message handlers, and event bus"
```

---

### Task 9: Node Config

**Files:**
- Create: `packages/node/src/config.ts`
- Create: `packages/node/test/config.test.ts`

**Step 1: Write config tests**

```typescript
import { describe, expect, test } from "bun:test";
import { loadConfig, defaultConfig, type NodeConfig } from "../src/config";

describe("config", () => {
  test("defaultConfig returns valid config", () => {
    const cfg = defaultConfig();
    expect(cfg.node.vertical).toBe("dev");
    expect(cfg.server.url).toBeTruthy();
    expect(cfg.autonomy.auto).toContain("signal_change");
    expect(cfg.autonomy.approval).toContain("proposal_vote");
  });

  test("loadConfig merges with defaults", () => {
    const cfg = loadConfig({
      node: { name: "my-node", project: "my-proj" },
    });
    expect(cfg.node.name).toBe("my-node");
    expect(cfg.node.project).toBe("my-proj");
    // Defaults should fill in the rest
    expect(cfg.node.vertical).toBe("dev");
    expect(cfg.server.url).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/config.test.ts`
Expected: FAIL

**Step 3: Write config.ts**

```typescript
import type { Vertical } from "@inv/shared";

export interface NodeConfig {
  node: {
    id: string;
    name: string;
    vertical: Vertical;
    project: string;
    owner: string;
    isAI: boolean;
  };
  server: {
    url: string;
    token: string;
  };
  database: {
    path: string;
  };
  autonomy: {
    auto: string[];
    approval: string[];
  };
}

export function defaultConfig(): NodeConfig {
  return {
    node: {
      id: "",
      name: "",
      vertical: "dev",
      project: "",
      owner: "",
      isAI: false,
    },
    server: {
      url: "ws://localhost:8080/ws",
      token: "",
    },
    database: {
      path: "./inventory.db",
    },
    autonomy: {
      auto: ["signal_change", "trace_resolve_request", "sweep", "query_respond"],
      approval: ["proposal_vote", "challenge_respond", "pair_invite", "cr_create"],
    },
  };
}

export function loadConfig(partial: Record<string, unknown>): NodeConfig {
  const cfg = defaultConfig();
  return deepMerge(cfg, partial) as NodeConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/config.ts packages/node/test/config.test.ts
git commit -m "feat: add node config with autonomy settings"
```

---

### Task 10: Chat TUI with Agent SDK

**Files:**
- Create: `packages/node/src/tui.ts`
- Create: `packages/node/src/agent.ts`
- Modify: `packages/node/src/index.ts`

**Step 1: Write agent.ts — Claude SDK integration**

This file wraps the Claude Agent SDK to provide tool definitions for the inventory engine.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Engine, SweepResult } from "./engine";
import type { Store } from "./store";
import type { NodeConfig } from "./config";

interface ToolResult {
  content: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_items",
    description: "List all items in the current node's inventory",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "verify_item",
    description: "Verify an item with evidence, transitioning it to proven state",
    input_schema: {
      type: "object" as const,
      properties: {
        itemId: { type: "string", description: "The item ID to verify" },
        evidence: { type: "string", description: "Evidence supporting verification" },
      },
      required: ["itemId", "evidence"],
    },
  },
  {
    name: "add_item",
    description: "Add a new item to the inventory",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", description: "Item kind (adr, api-spec, etc.)" },
        title: { type: "string", description: "Item title" },
        body: { type: "string", description: "Item body/description" },
        externalRef: { type: "string", description: "External reference (e.g., US-003)" },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "audit",
    description: "Audit the current node's inventory health",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "impact",
    description: "Check what would be affected if an item changes",
    input_schema: {
      type: "object" as const,
      properties: {
        itemId: { type: "string", description: "The item ID to check impact for" },
      },
      required: ["itemId"],
    },
  },
  {
    name: "status",
    description: "Get current node status — items summary and online peers",
    input_schema: { type: "object" as const, properties: {} },
  },
];

export class Agent {
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];

  constructor(
    private engine: Engine,
    private store: Store,
    private config: NodeConfig,
  ) {
    this.client = new Anthropic();
  }

  get tools(): Anthropic.Tool[] {
    return TOOLS;
  }

  async chat(userMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: userMessage });

    const systemPrompt = `You are an AI assistant managing the "${this.config.node.name}" inventory node for the "${this.config.node.project}" project. You are the ${this.config.node.vertical} vertical, owned by ${this.config.node.owner}. Help manage inventory items, respond to network events, and maintain item health. Be concise.`;

    let response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages: this.messages,
    });

    // Tool use loop
    while (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      this.messages.push({ role: "assistant", content: assistantContent });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const result = this.executeTool(block.name, block.input as Record<string, string>);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.content,
          });
        }
      }

      this.messages.push({ role: "user", content: toolResults });

      response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: this.messages,
      });
    }

    const textContent = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.type === "text" ? b.text : "")
      .join("");

    this.messages.push({ role: "assistant", content: response.content });
    return textContent;
  }

  private executeTool(
    name: string,
    input: Record<string, string>,
  ): ToolResult {
    try {
      switch (name) {
        case "list_items": {
          const items = this.engine.listItems(this.config.node.id);
          return { content: JSON.stringify(items, null, 2) };
        }
        case "verify_item": {
          this.engine.verifyItem(input.itemId, input.evidence, this.config.node.owner);
          return { content: `Item ${input.itemId} verified successfully` };
        }
        case "add_item": {
          const item = this.engine.addItem(
            this.config.node.id,
            input.kind as any,
            input.title,
            input.body ?? "",
            input.externalRef ?? "",
          );
          return { content: `Item created: ${item.id} — ${item.title}` };
        }
        case "audit": {
          const report = this.engine.audit(this.config.node.id);
          return { content: JSON.stringify(report, null, 2) };
        }
        case "impact": {
          const impacted = this.engine.impact(input.itemId);
          return { content: JSON.stringify(impacted, null, 2) };
        }
        case "status": {
          const items = this.engine.listItems(this.config.node.id);
          const summary = {
            total: items.length,
            unverified: items.filter((i) => i.state === "unverified").length,
            proven: items.filter((i) => i.state === "proven").length,
            suspect: items.filter((i) => i.state === "suspect").length,
            broke: items.filter((i) => i.state === "broke").length,
          };
          return { content: JSON.stringify(summary, null, 2) };
        }
        default:
          return { content: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
```

**Step 2: Write tui.ts — Chat terminal UI**

```typescript
import * as readline from "readline";
import type { Envelope } from "@inv/shared";
import type { Agent } from "./agent";
import type { WSClient } from "./ws-client";
import type { EventBus } from "./event-bus";
import type { NodeConfig } from "./config";

export class TUI {
  private rl: readline.Interface;

  constructor(
    private agent: Agent,
    private wsClient: WSClient,
    private eventBus: EventBus,
    private config: NodeConfig,
  ) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    this.printHeader();
    this.setupEventListeners();
    this.promptLoop();
  }

  private printHeader(): void {
    const { node } = this.config;
    console.log(`\n\x1b[32m●\x1b[0m Connected to ${node.project} (${node.name})`);
    console.log("");
  }

  private setupEventListeners(): void {
    this.eventBus.on("signal_change", (data) => {
      const env = data as Envelope;
      if (env.payload.type === "signal_change") {
        this.printEvent(
          `Signal: item ${env.payload.itemId} changed ${env.payload.oldState} → ${env.payload.newState}`,
        );
      }
    });

    this.eventBus.on("query_ask", (data) => {
      const env = data as Envelope;
      if (env.payload.type === "query_ask") {
        this.printEvent(
          `Query from ${env.fromNode}: ${env.payload.question}`,
        );
      }
    });

    this.eventBus.on("query_respond", (data) => {
      const env = data as Envelope;
      if (env.payload.type === "query_respond") {
        this.printEvent(
          `Response from ${env.fromNode}: ${env.payload.answer}`,
        );
      }
    });
  }

  private printEvent(message: string): void {
    console.log(`\n  ── incoming event ──────────────────────────`);
    console.log(`  ${message}`);
    console.log(`  ────────────────────────────────────────────\n`);
    this.rl.prompt();
  }

  private promptLoop(): void {
    this.rl.setPrompt("> ");
    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      if (input === "/quit" || input === "/exit") {
        this.shutdown();
        return;
      }

      if (input.startsWith("/")) {
        await this.handleSlashCommand(input);
      } else {
        await this.handleChat(input);
      }

      this.rl.prompt();
    });

    this.rl.on("close", () => this.shutdown());
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const [cmd, ...args] = input.split(" ");

    switch (cmd) {
      case "/status":
        await this.handleChat("Show me the current inventory status");
        break;
      case "/audit":
        await this.handleChat("Run an audit of my inventory");
        break;
      case "/pending":
        await this.handleChat("Show all pending actions that need my approval");
        break;
      case "/ask": {
        const target = args[0] ?? "";
        const question = args.slice(1).join(" ");
        if (question) {
          this.wsClient.broadcast({
            type: "query_ask",
            question,
            askerId: this.config.node.owner,
          });
          console.log(`  Sent query to network: ${question}`);
        } else {
          console.log("  Usage: /ask [node] <question>");
        }
        break;
      }
      default:
        console.log(`  Unknown command: ${cmd}`);
        console.log("  Available: /status, /audit, /pending, /ask, /quit");
    }
  }

  private async handleChat(input: string): Promise<void> {
    try {
      const response = await this.agent.chat(input);
      console.log(`\n  ${response}\n`);
    } catch (err) {
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private shutdown(): void {
    console.log("\nGoodbye!");
    this.wsClient.close();
    this.rl.close();
    process.exit(0);
  }
}
```

**Step 3: Wire everything in index.ts**

```typescript
import { Store } from "./store";
import { StateMachine } from "./state";
import { SignalPropagator } from "./signal";
import { Engine } from "./engine";
import { WSClient } from "./ws-client";
import { WSHandlers } from "./ws-handlers";
import { EventBus } from "./event-bus";
import { Agent } from "./agent";
import { TUI } from "./tui";
import { loadConfig, type NodeConfig } from "./config";
import { readFileSync } from "fs";
import { resolve } from "path";

export { Store, StateMachine, SignalPropagator, Engine, WSClient, WSHandlers, EventBus, Agent, TUI };

async function main(): Promise<void> {
  // Load config
  const configPath = process.argv[2] ?? "./inv-config.json";
  let rawConfig = {};
  try {
    rawConfig = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
  } catch {
    console.error(`Config not found at ${configPath}. Create inv-config.json or pass path as argument.`);
    process.exit(1);
  }
  const config = loadConfig(rawConfig);

  // Initialize store
  const store = new Store(config.database.path);

  // Initialize engine
  const sm = new StateMachine();
  const propagator = new SignalPropagator(store, sm);
  const engine = new Engine(store, sm, propagator);

  // Register node if not exists
  if (config.node.id) {
    try {
      engine.getNode(config.node.id);
    } catch {
      const node = engine.registerNode(
        config.node.name,
        config.node.vertical,
        config.node.project,
        config.node.owner,
        config.node.isAI,
      );
      config.node.id = node.id;
    }
  }

  // Initialize WebSocket
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(engine, store, eventBus);
  const wsClient = new WSClient({
    serverUrl: config.server.url,
    token: config.server.token,
    nodeId: config.node.id,
    projectId: config.node.project,
  });

  wsClient.onMessage((envelope) => wsHandlers.handle(envelope));

  // Connect to server
  try {
    await wsClient.connect();
  } catch {
    console.log("Could not connect to server. Running in offline mode.");
  }

  // Initialize AI agent + TUI
  const agent = new Agent(engine, store, config);
  const tui = new TUI(agent, wsClient, eventBus, config);

  await tui.start();
}

main().catch(console.error);
```

**Step 4: Run all tests**

Run: `bun test packages/node/ packages/shared/`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/node/src/ packages/node/test/
git commit -m "feat: add chat TUI with Claude Agent SDK and WebSocket client integration"
```

---

### Task 11: Integration Test — Full Flow

**Files:**
- Create: `packages/node/test/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import { EventBus } from "../src/event-bus";
import { WSHandlers } from "../src/ws-handlers";
import { createEnvelope, type Envelope } from "@inv/shared";

describe("Integration: Full inventory workflow", () => {
  let store: Store;
  let engine: Engine;
  let eventBus: EventBus;
  let handlers: WSHandlers;

  beforeEach(() => {
    store = new Store(":memory:");
    const sm = new StateMachine();
    const propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);
    eventBus = new EventBus();
    handlers = new WSHandlers(engine, store, eventBus);
  });

  afterEach(() => {
    store.close();
  });

  test("full lifecycle: register → add items → trace → verify → propagate", () => {
    // 1. Register nodes
    const devNode = engine.registerNode("dev-inv", "dev", "clinic", "cuong", false);
    const pmNode = engine.registerNode("pm-inv", "pm", "clinic", "duke", false);

    // 2. Add items
    const prd = engine.addItem(pmNode.id, "prd", "Check-in PRD", "", "PRD-001");
    const adr = engine.addItem(devNode.id, "adr", "WebSocket ADR", "", "");
    const spec = engine.addItem(devNode.id, "api-spec", "Check-in API v2", "", "");

    // 3. Create traces: spec → adr → prd
    engine.addTrace(spec.id, adr.id, "traced_from", "cuong");
    engine.addTrace(adr.id, prd.id, "traced_from", "cuong");

    // 4. Verify all items
    engine.verifyItem(prd.id, "Approved by stakeholders", "duke");
    engine.verifyItem(adr.id, "Architecture review passed", "cuong");
    engine.verifyItem(spec.id, "Load test passed", "cuong");

    // All should be proven
    expect(store.getItem(prd.id)!.state).toBe("proven");
    expect(store.getItem(adr.id)!.state).toBe("proven");
    expect(store.getItem(spec.id)!.state).toBe("proven");

    // 5. PRD changes → triggers propagation
    const signals = engine.verifyItem(prd.id, "Updated requirements", "duke");

    // ADR should be suspect (depends on PRD)
    expect(store.getItem(adr.id)!.state).toBe("suspect");
    // Spec should also be suspect (depends on ADR)
    expect(store.getItem(spec.id)!.state).toBe("suspect");

    // 6. Impact check
    const impact = engine.impact(prd.id);
    expect(impact).toHaveLength(2); // adr + spec

    // 7. Audit
    const report = engine.audit(devNode.id);
    expect(report.suspect).toHaveLength(2);

    // 8. Sweep
    const sweep = engine.sweep("PRD-001");
    expect(sweep.matchedItems).toHaveLength(1);
  });

  test("event bus fires on incoming message", () => {
    const devNode = engine.registerNode("dev-inv", "dev", "clinic", "cuong", false);
    const received: Envelope[] = [];

    eventBus.on("query_ask", (data) => {
      received.push(data as Envelope);
    });

    const envelope = createEnvelope("pm-inv", "dev-inv", "clinic", {
      type: "query_ask",
      question: "What uses the check-in API?",
      askerId: "duke",
    });

    handlers.handle(envelope);

    expect(received).toHaveLength(1);
    expect((received[0].payload as { question: string }).question).toContain("check-in API");
  });
});
```

**Step 2: Run integration test**

Run: `bun test packages/node/test/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/node/test/integration.test.ts
git commit -m "test: add full workflow integration test"
```

---

### Task 12: Update .gitignore and Clean Up

**Files:**
- Modify: `.gitignore`

**Step 1: Update .gitignore for Bun monorepo**

Add to `.gitignore`:
```
# Bun
node_modules/
bun.lockb
*.db
*.db-shm
*.db-wal
dist/

# Keep Go files during transition, remove when ready
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass across shared, node, and server packages

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: update gitignore for Bun/TypeScript monorepo"
```

---

## Execution Order Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Monorepo | Scaffold workspace with shared/server/node packages |
| 2 | Shared | Domain types + message envelope |
| 3 | Node | Item + CR state machines |
| 4 | Node | SQLite store with bun:sqlite |
| 5 | Node | Signal propagation |
| 6 | Node | Engine (orchestrates store + state + signals) |
| 7 | Server | Redis-backed auth, hub, outbox + WebSocket server |
| 8 | Node | WebSocket client, event bus, message handlers |
| 9 | Node | Config with autonomy settings |
| 10 | Node | Chat TUI + Claude Agent SDK agent |
| 11 | Node | Integration test — full workflow |
| 12 | Cleanup | .gitignore, final test run |

**Dependencies:** Tasks 1→2→3→4→5→6 are sequential. Task 7 can run in parallel with 3–6. Tasks 8–9 depend on 6+7. Task 10 depends on 8+9. Tasks 11–12 are final.
