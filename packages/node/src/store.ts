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
  PendingAction,
  AuditReport,
  Vertical,
  ItemState,
  ItemKind,
  TraceRelation,
  TransitionKind,
  ChangeRequest,
  Vote,
  VoteTally,
  CRStatus,
  PairSession,
  ChecklistItem,
  KindMapping,
} from "@inv/shared";

// ── Row types (snake_case DB representation) ────────────────────────────

interface NodeRow {
  id: string;
  name: string;
  vertical: string;
  project: string;
  owner: string;
  is_ai: number;
  created_at: string;
}

interface ItemRow {
  id: string;
  node_id: string;
  kind: string;
  title: string;
  body: string;
  external_ref: string;
  state: string;
  evidence: string;
  confirmed_by: string;
  confirmed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface TraceRow {
  id: string;
  from_item_id: string;
  from_node_id: string;
  to_item_id: string;
  to_node_id: string;
  relation: string;
  confirmed_by: string;
  confirmed_at: string | null;
  created_at: string;
}

interface SignalRow {
  id: string;
  kind: string;
  source_item: string;
  source_node: string;
  target_item: string;
  target_node: string;
  payload: string;
  processed: number;
  created_at: string;
}

interface TransitionRow {
  id: string;
  item_id: string;
  kind: string;
  from_s: string;
  to_s: string;
  evidence: string;
  reason: string;
  actor: string;
  timestamp: string;
}

interface QueryRow {
  id: string;
  asker_id: string;
  asker_node: string;
  question: string;
  context: string;
  target_node: string;
  resolved: number;
  created_at: string;
}

interface QueryResponseRow {
  id: string;
  query_id: string;
  responder_id: string;
  node_id: string;
  answer: string;
  is_ai: number;
  created_at: string;
}

interface PendingActionRow {
  id: string;
  message_type: string;
  envelope: string;
  summary: string;
  proposed: string;
  status: string;
  created_at: string;
}

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

// ── Input types for create methods ──────────────────────────────────────

interface CreateNodeInput {
  name: string;
  vertical: Vertical;
  project: string;
  owner: string;
  isAI: boolean;
}

interface CreateItemInput {
  nodeId: string;
  kind: ItemKind;
  title: string;
  body?: string;
  externalRef?: string;
}

interface CreateTraceInput {
  fromItemId: string;
  fromNodeId: string;
  toItemId: string;
  toNodeId: string;
  relation: TraceRelation;
}

interface CreateSignalInput {
  kind: Signal["kind"];
  sourceItem: string;
  sourceNode: string;
  targetItem: string;
  targetNode: string;
  payload?: string;
}

interface RecordTransitionInput {
  itemId: string;
  kind: TransitionKind;
  from: ItemState;
  to: ItemState;
  evidence?: string;
  reason?: string;
  actor: string;
}

interface CreateQueryInput {
  askerId: string;
  askerNode: string;
  question: string;
  context?: string;
  targetNode?: string;
}

interface CreateQueryResponseInput {
  queryId: string;
  responderId: string;
  nodeId: string;
  answer: string;
  isAI: boolean;
}

interface CreatePendingActionInput {
  messageType: string;
  envelope: string;
  summary: string;
  proposed: string;
}

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

// ── Row mapper methods ──────────────────────────────────────────────────

function mapNodeRow(row: NodeRow): Node {
  return {
    id: row.id,
    name: row.name,
    vertical: row.vertical as Vertical,
    project: row.project,
    owner: row.owner,
    isAI: row.is_ai === 1,
    createdAt: row.created_at,
  };
}

function mapItemRow(row: ItemRow): Item {
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind as ItemKind,
    title: row.title,
    body: row.body,
    externalRef: row.external_ref,
    state: row.state as ItemState,
    evidence: row.evidence,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTraceRow(row: TraceRow): Trace {
  return {
    id: row.id,
    fromItemId: row.from_item_id,
    fromNodeId: row.from_node_id,
    toItemId: row.to_item_id,
    toNodeId: row.to_node_id,
    relation: row.relation as TraceRelation,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function mapSignalRow(row: SignalRow): Signal {
  return {
    id: row.id,
    kind: row.kind as Signal["kind"],
    sourceItem: row.source_item,
    sourceNode: row.source_node,
    targetItem: row.target_item,
    targetNode: row.target_node,
    payload: row.payload,
    processed: row.processed === 1,
    createdAt: row.created_at,
  };
}

function mapTransitionRow(row: TransitionRow): Transition {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: row.kind as TransitionKind,
    from: row.from_s as ItemState,
    to: row.to_s as ItemState,
    evidence: row.evidence,
    reason: row.reason,
    actor: row.actor,
    timestamp: row.timestamp,
  };
}

function mapQueryRow(row: QueryRow): Query {
  return {
    id: row.id,
    askerId: row.asker_id,
    askerNode: row.asker_node,
    question: row.question,
    context: row.context,
    targetNode: row.target_node,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
  };
}

function mapQueryResponseRow(row: QueryResponseRow): QueryResponse {
  return {
    id: row.id,
    queryId: row.query_id,
    responderId: row.responder_id,
    nodeId: row.node_id,
    answer: row.answer,
    isAI: row.is_ai === 1,
    createdAt: row.created_at,
  };
}

function mapPendingActionRow(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    messageType: row.message_type,
    envelope: row.envelope,
    summary: row.summary,
    proposed: row.proposed,
    status: row.status as PendingAction["status"],
    createdAt: row.created_at,
  };
}

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

// ── Store class ─────────────────────────────────────────────────────────

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  // ── Migrations ──────────────────────────────────────────────────────

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        vertical TEXT NOT NULL,
        project TEXT NOT NULL,
        owner TEXT NOT NULL,
        is_ai INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
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
      )
    `);

    this.db.run(`
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
      )
    `);

    this.db.run(`
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
      )
    `);

    this.db.run(`
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
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS queries (
        id TEXT PRIMARY KEY,
        asker_id TEXT NOT NULL,
        asker_node TEXT NOT NULL,
        question TEXT NOT NULL,
        context TEXT DEFAULT '',
        target_node TEXT DEFAULT '',
        resolved INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS query_responses (
        id TEXT PRIMARY KEY,
        query_id TEXT NOT NULL REFERENCES queries(id),
        responder_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        is_ai INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY,
        message_type TEXT NOT NULL,
        envelope TEXT NOT NULL,
        summary TEXT NOT NULL,
        proposed TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS change_requests (
        id TEXT PRIMARY KEY,
        proposer_node TEXT NOT NULL,
        proposer_id TEXT NOT NULL,
        target_item_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS votes (
        id TEXT PRIMARY KEY,
        cr_id TEXT NOT NULL REFERENCES change_requests(id),
        node_id TEXT NOT NULL,
        vertical TEXT NOT NULL,
        approve INTEGER NOT NULL,
        reason TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(cr_id, node_id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS pair_sessions (
        id TEXT PRIMARY KEY,
        initiator_node TEXT NOT NULL,
        partner_node TEXT NOT NULL,
        project TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS checklists (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        text TEXT NOT NULL,
        checked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS kind_mappings (
        id TEXT PRIMARY KEY,
        from_vertical TEXT NOT NULL,
        from_kind TEXT NOT NULL,
        to_vertical TEXT NOT NULL,
        to_kind TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(from_vertical, from_kind, to_vertical)
      )
    `);
  }

  // ── Nodes ───────────────────────────────────────────────────────────

  createNode(input: CreateNodeInput): Node {
    const id = randomUUID();
    const stmt = this.db.query<NodeRow, [string, string, string, string, string, number]>(
      `INSERT INTO nodes (id, name, vertical, project, owner, is_ai)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(id, input.name, input.vertical, input.project, input.owner, input.isAI ? 1 : 0);
    if (!row) throw new Error("Failed to create node");
    return mapNodeRow(row);
  }

  getNode(id: string): Node | null {
    const row = this.db.query<NodeRow, [string]>(
      "SELECT * FROM nodes WHERE id = ?",
    ).get(id);
    return row ? mapNodeRow(row) : null;
  }

  listNodes(project: string): Node[] {
    const rows = this.db.query<NodeRow, [string]>(
      "SELECT * FROM nodes WHERE project = ?",
    ).all(project);
    return rows.map(mapNodeRow);
  }

  // ── Items ───────────────────────────────────────────────────────────

  createItem(input: CreateItemInput): Item {
    const id = randomUUID();
    const stmt = this.db.query<ItemRow, [string, string, string, string, string, string]>(
      `INSERT INTO items (id, node_id, kind, title, body, external_ref)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.nodeId,
      input.kind,
      input.title,
      input.body ?? "",
      input.externalRef ?? "",
    );
    if (!row) throw new Error("Failed to create item");
    return mapItemRow(row);
  }

  getItem(id: string): Item | null {
    const row = this.db.query<ItemRow, [string]>(
      "SELECT * FROM items WHERE id = ?",
    ).get(id);
    return row ? mapItemRow(row) : null;
  }

  listItems(nodeId: string): Item[] {
    const rows = this.db.query<ItemRow, [string]>(
      "SELECT * FROM items WHERE node_id = ?",
    ).all(nodeId);
    return rows.map(mapItemRow);
  }

  updateItemStatus(
    id: string,
    state: ItemState,
    evidence: string,
    confirmedBy: string,
  ): Item {
    const stmt = this.db.query<ItemRow, [string, string, string, string]>(
      `UPDATE items
       SET state = ?, evidence = ?, confirmed_by = ?,
           confirmed_at = datetime('now'),
           version = version + 1,
           updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`,
    );
    const row = stmt.get(state, evidence, confirmedBy, id);
    if (!row) throw new Error(`Item not found: ${id}`);
    return mapItemRow(row);
  }

  findItemsByExternalRef(externalRef: string): Item[] {
    const rows = this.db.query<ItemRow, [string]>(
      "SELECT * FROM items WHERE external_ref = ?",
    ).all(externalRef);
    return rows.map(mapItemRow);
  }

  // ── Traces ──────────────────────────────────────────────────────────

  createTrace(input: CreateTraceInput): Trace {
    const id = randomUUID();
    const stmt = this.db.query<TraceRow, [string, string, string, string, string, string]>(
      `INSERT INTO traces (id, from_item_id, from_node_id, to_item_id, to_node_id, relation)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.fromItemId,
      input.fromNodeId,
      input.toItemId,
      input.toNodeId,
      input.relation,
    );
    if (!row) throw new Error("Failed to create trace");
    return mapTraceRow(row);
  }

  /** Returns all traces involving the item (either as source or target). */
  getItemTraces(itemId: string): Trace[] {
    const rows = this.db.query<TraceRow, [string, string]>(
      "SELECT * FROM traces WHERE from_item_id = ? OR to_item_id = ?",
    ).all(itemId, itemId);
    return rows.map(mapTraceRow);
  }

  /** Finds items that depend on a given item (WHERE to_item_id = ?). */
  getDependentTraces(itemId: string): Trace[] {
    const rows = this.db.query<TraceRow, [string]>(
      "SELECT * FROM traces WHERE to_item_id = ?",
    ).all(itemId);
    return rows.map(mapTraceRow);
  }

  /** Finds upstream traces originating from a given item (WHERE from_item_id = ?). */
  getUpstreamTraces(itemId: string): Trace[] {
    const rows = this.db.query<TraceRow, [string]>(
      "SELECT * FROM traces WHERE from_item_id = ?",
    ).all(itemId);
    return rows.map(mapTraceRow);
  }

  // ── Signals ─────────────────────────────────────────────────────────

  createSignal(input: CreateSignalInput): Signal {
    const id = randomUUID();
    const stmt = this.db.query<SignalRow, [string, string, string, string, string, string, string]>(
      `INSERT INTO signals (id, kind, source_item, source_node, target_item, target_node, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.kind,
      input.sourceItem,
      input.sourceNode,
      input.targetItem,
      input.targetNode,
      input.payload ?? "",
    );
    if (!row) throw new Error("Failed to create signal");
    return mapSignalRow(row);
  }

  markSignalProcessed(id: string): void {
    this.db.query("UPDATE signals SET processed = 1 WHERE id = ?").run(id);
  }

  // ── Transitions ─────────────────────────────────────────────────────

  recordTransition(input: RecordTransitionInput): Transition {
    const id = randomUUID();
    const stmt = this.db.query<TransitionRow, [string, string, string, string, string, string, string, string]>(
      `INSERT INTO transitions (id, item_id, kind, from_s, to_s, evidence, reason, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.itemId,
      input.kind,
      input.from,
      input.to,
      input.evidence ?? "",
      input.reason ?? "",
      input.actor,
    );
    if (!row) throw new Error("Failed to record transition");
    return mapTransitionRow(row);
  }

  getItemTransitions(itemId: string): Transition[] {
    const rows = this.db.query<TransitionRow, [string]>(
      "SELECT * FROM transitions WHERE item_id = ? ORDER BY timestamp",
    ).all(itemId);
    return rows.map(mapTransitionRow);
  }

  // ── Queries ─────────────────────────────────────────────────────────

  createQuery(input: CreateQueryInput): Query {
    const id = randomUUID();
    const stmt = this.db.query<QueryRow, [string, string, string, string, string, string]>(
      `INSERT INTO queries (id, asker_id, asker_node, question, context, target_node)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.askerId,
      input.askerNode,
      input.question,
      input.context ?? "",
      input.targetNode ?? "",
    );
    if (!row) throw new Error("Failed to create query");
    return mapQueryRow(row);
  }

  createQueryResponse(input: CreateQueryResponseInput): QueryResponse {
    const id = randomUUID();
    const stmt = this.db.query<QueryResponseRow, [string, string, string, string, string, number]>(
      `INSERT INTO query_responses (id, query_id, responder_id, node_id, answer, is_ai)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.queryId,
      input.responderId,
      input.nodeId,
      input.answer,
      input.isAI ? 1 : 0,
    );
    if (!row) throw new Error("Failed to create query response");
    return mapQueryResponseRow(row);
  }

  // ── Pending Actions ─────────────────────────────────────────────────

  createPendingAction(input: CreatePendingActionInput): PendingAction {
    const id = randomUUID();
    const stmt = this.db.query<PendingActionRow, [string, string, string, string, string]>(
      `INSERT INTO pending_actions (id, message_type, envelope, summary, proposed)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.messageType,
      input.envelope,
      input.summary,
      input.proposed,
    );
    if (!row) throw new Error("Failed to create pending action");
    return mapPendingActionRow(row);
  }

  listPendingActions(): PendingAction[] {
    const rows = this.db.query<PendingActionRow, []>(
      "SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at",
    ).all();
    return rows.map(mapPendingActionRow);
  }

  updatePendingActionStatus(id: string, status: PendingAction["status"]): void {
    this.db.query("UPDATE pending_actions SET status = ? WHERE id = ?").run(status, id);
  }

  // ── Change Requests ────────────────────────────────────────────────

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
      `UPDATE change_requests
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`,
    );
    const row = stmt.get(status, id);
    if (!row) throw new Error(`Change request not found: ${id}`);
    return mapChangeRequestRow(row);
  }

  listChangeRequests(status?: CRStatus): ChangeRequest[] {
    if (status) {
      const rows = this.db.query<ChangeRequestRow, [string]>(
        "SELECT * FROM change_requests WHERE status = ? ORDER BY created_at",
      ).all(status);
      return rows.map(mapChangeRequestRow);
    }
    const rows = this.db.query<ChangeRequestRow, []>(
      "SELECT * FROM change_requests ORDER BY created_at",
    ).all();
    return rows.map(mapChangeRequestRow);
  }

  // ── Votes ──────────────────────────────────────────────────────────

  createVote(input: CreateVoteInput): Vote {
    const id = randomUUID();
    const stmt = this.db.query<VoteRow, [string, string, string, string, number, string]>(
      `INSERT INTO votes (id, cr_id, node_id, vertical, approve, reason)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(
      id,
      input.crId,
      input.nodeId,
      input.vertical,
      input.approve ? 1 : 0,
      input.reason,
    );
    if (!row) throw new Error("Failed to create vote");
    return mapVoteRow(row);
  }

  listVotes(crId: string): Vote[] {
    const rows = this.db.query<VoteRow, [string]>(
      "SELECT * FROM votes WHERE cr_id = ? ORDER BY created_at",
    ).all(crId);
    return rows.map(mapVoteRow);
  }

  tallyVotes(crId: string): VoteTally {
    const votes = this.listVotes(crId);
    let approved = 0;
    let rejected = 0;
    for (const vote of votes) {
      if (vote.approve) {
        approved++;
      } else {
        rejected++;
      }
    }
    return { approved, rejected, total: votes.length };
  }

  // ── Pair Sessions ────────────────────────────────────────────────────

  createPairSession(input: CreatePairSessionInput): PairSession {
    const id = randomUUID();
    const stmt = this.db.query<PairSessionRow, [string, string, string, string]>(
      `INSERT INTO pair_sessions (id, initiator_node, partner_node, project)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(id, input.initiatorNode, input.partnerNode, input.project);
    if (!row) throw new Error("Failed to create pair session");
    return mapPairSessionRow(row);
  }

  getPairSession(id: string): PairSession | null {
    const row = this.db.query<PairSessionRow, [string]>(
      "SELECT * FROM pair_sessions WHERE id = ?",
    ).get(id);
    return row ? mapPairSessionRow(row) : null;
  }

  updatePairSessionStatus(id: string, status: PairSession["status"]): PairSession {
    if (status === "ended") {
      const stmt = this.db.query<PairSessionRow, [string, string]>(
        `UPDATE pair_sessions SET status = ?, ended_at = datetime('now') WHERE id = ? RETURNING *`,
      );
      const row = stmt.get(status, id);
      if (!row) throw new Error(`Pair session not found: ${id}`);
      return mapPairSessionRow(row);
    }
    const stmt = this.db.query<PairSessionRow, [string, string]>(
      `UPDATE pair_sessions SET status = ? WHERE id = ? RETURNING *`,
    );
    const row = stmt.get(status, id);
    if (!row) throw new Error(`Pair session not found: ${id}`);
    return mapPairSessionRow(row);
  }

  listPairSessions(nodeId: string): PairSession[] {
    const rows = this.db.query<PairSessionRow, [string, string]>(
      "SELECT * FROM pair_sessions WHERE (initiator_node = ? OR partner_node = ?) AND status != 'ended' ORDER BY started_at",
    ).all(nodeId, nodeId);
    return rows.map(mapPairSessionRow);
  }

  // ── Checklists ───────────────────────────────────────────────────────

  createChecklistItem(input: CreateChecklistItemInput): ChecklistItem {
    const id = randomUUID();
    const stmt = this.db.query<ChecklistItemRow, [string, string, string]>(
      `INSERT INTO checklists (id, item_id, text)
       VALUES (?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(id, input.itemId, input.text);
    if (!row) throw new Error("Failed to create checklist item");
    return mapChecklistItemRow(row);
  }

  getChecklistItem(id: string): ChecklistItem | null {
    const row = this.db.query<ChecklistItemRow, [string]>(
      "SELECT * FROM checklists WHERE id = ?",
    ).get(id);
    return row ? mapChecklistItemRow(row) : null;
  }

  updateChecklistItemChecked(id: string, checked: boolean): void {
    this.db.query("UPDATE checklists SET checked = ? WHERE id = ?").run(checked ? 1 : 0, id);
  }

  listChecklistItems(itemId: string): ChecklistItem[] {
    const rows = this.db.query<ChecklistItemRow, [string]>(
      "SELECT * FROM checklists WHERE item_id = ? ORDER BY created_at",
    ).all(itemId);
    return rows.map(mapChecklistItemRow);
  }

  // ── Kind Mappings ────────────────────────────────────────────────────

  createKindMapping(input: CreateKindMappingInput): KindMapping {
    const id = randomUUID();
    const stmt = this.db.query<KindMappingRow, [string, string, string, string, string]>(
      `INSERT INTO kind_mappings (id, from_vertical, from_kind, to_vertical, to_kind)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
    );
    const row = stmt.get(id, input.fromVertical, input.fromKind, input.toVertical, input.toKind);
    if (!row) throw new Error("Failed to create kind mapping");
    return mapKindMappingRow(row);
  }

  getMappedKind(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical): ItemKind | null {
    const row = this.db.query<KindMappingRow, [string, string, string]>(
      "SELECT * FROM kind_mappings WHERE from_vertical = ? AND from_kind = ? AND to_vertical = ?",
    ).get(fromVertical, fromKind, toVertical);
    return row ? (row.to_kind as ItemKind) : null;
  }

  listKindMappings(): KindMapping[] {
    const rows = this.db.query<KindMappingRow, []>(
      "SELECT * FROM kind_mappings ORDER BY created_at",
    ).all();
    return rows.map(mapKindMappingRow);
  }

  // ── Audit ───────────────────────────────────────────────────────────

  audit(nodeId: string): AuditReport {
    const node = this.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const items = this.listItems(nodeId);

    const unverified: string[] = [];
    const proven: string[] = [];
    const suspect: string[] = [];
    const broke: string[] = [];
    const orphans: string[] = [];
    const missingUpstreamRefs: string[] = [];

    for (const item of items) {
      // Categorize by state
      switch (item.state) {
        case "unverified":
          unverified.push(item.id);
          break;
        case "proven":
          proven.push(item.id);
          break;
        case "suspect":
          suspect.push(item.id);
          break;
        case "broke":
          broke.push(item.id);
          break;
      }

      // Check for orphans (items with no traces at all)
      const traces = this.getItemTraces(item.id);
      if (traces.length === 0) {
        orphans.push(item.id);
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
}
