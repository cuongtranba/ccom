import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ── Types ─────────────────────────────────────────────────────────────

export interface PendingAction {
  id: string;
  messageType: string;
  envelope: string;
  summary: string;
  proposed: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  proposerNode: string;
  proposerId: string;
  targetItemId: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vote {
  id: string;
  crId: string;
  nodeId: string;
  vertical: string;
  approve: boolean;
  reason: string;
  createdAt: string;
}

export interface Item {
  id: string;
  nodeId: string;
  kind: string;
  title: string;
  state: string;
}

export interface NodeInfo {
  id: string;
  name: string;
  vertical: string;
  project: string;
  owner: string;
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
}

export interface DashboardStats {
  pendingCount: number;
  votingCount: number;
  challengeCount: number;
  pairCount: number;
  dbPath: string;
}

// ── DB path resolution ────────────────────────────────────────────────

function getDbPath(): string {
  if (process.env.INV_DB_PATH) return process.env.INV_DB_PATH;

  const candidates = [
    "./inv-config.json",
    "../inv-config.json",
    "../../inv-config.json",
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(resolved)) {
      try {
        const config = JSON.parse(readFileSync(resolved, "utf-8"));
        if (config.database?.path && config.database.path !== ":memory:") {
          return resolve(config.database.path);
        }
      } catch {
        /* skip invalid config */
      }
    }
  }

  return resolve("./inventory.db");
}

function openDb(): Database {
  const path = getDbPath();
  return new Database(path, { create: false });
}

// ── Reads ─────────────────────────────────────────────────────────────

export function listPendingActions(): PendingAction[] {
  const db = openDb();
  try {
    const rows = db
      .query(
        "SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC",
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      messageType: r.message_type as string,
      envelope: r.envelope as string,
      summary: r.summary as string,
      proposed: r.proposed as string,
      status: r.status as PendingAction["status"],
      createdAt: r.created_at as string,
    }));
  } finally {
    db.close();
  }
}

export function listVotingCRs(): ChangeRequest[] {
  const db = openDb();
  try {
    const rows = db
      .query(
        "SELECT * FROM change_requests WHERE status IN ('voting', 'proposed') ORDER BY created_at DESC",
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      proposerNode: r.proposer_node as string,
      proposerId: r.proposer_id as string,
      targetItemId: r.target_item_id as string,
      description: r.description as string,
      status: r.status as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  } finally {
    db.close();
  }
}

export function listActiveChallenges(): ChangeRequest[] {
  const db = openDb();
  try {
    const rows = db
      .query(
        "SELECT * FROM change_requests WHERE status IN ('voting', 'proposed') AND description LIKE 'Challenge:%' ORDER BY created_at DESC",
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      proposerNode: r.proposer_node as string,
      proposerId: r.proposer_id as string,
      targetItemId: r.target_item_id as string,
      description: r.description as string,
      status: r.status as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  } finally {
    db.close();
  }
}

export function listPendingPairSessions(nodeId: string): PairSession[] {
  const db = openDb();
  try {
    const rows = db
      .query(
        "SELECT * FROM pair_sessions WHERE status = 'pending' AND (initiator_node = ? OR partner_node = ?) ORDER BY started_at DESC",
      )
      .all(nodeId, nodeId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      initiatorNode: r.initiator_node as string,
      partnerNode: r.partner_node as string,
      project: r.project as string,
      status: r.status as PairSession["status"],
      startedAt: r.started_at as string,
    }));
  } finally {
    db.close();
  }
}

export function getVoteTally(crId: string): VoteTally {
  const db = openDb();
  try {
    const votes = db
      .query("SELECT approve FROM votes WHERE cr_id = ?")
      .all(crId) as { approve: number }[];
    const approved = votes.filter((v) => v.approve === 1).length;
    const rejected = votes.filter((v) => v.approve === 0).length;
    return { approved, rejected, total: votes.length };
  } finally {
    db.close();
  }
}

export function getVotes(crId: string): Vote[] {
  const db = openDb();
  try {
    const rows = db
      .query("SELECT * FROM votes WHERE cr_id = ? ORDER BY created_at")
      .all(crId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      crId: r.cr_id as string,
      nodeId: r.node_id as string,
      vertical: r.vertical as string,
      approve: (r.approve as number) === 1,
      reason: r.reason as string,
      createdAt: r.created_at as string,
    }));
  } finally {
    db.close();
  }
}

export function getItem(id: string): Item | null {
  const db = openDb();
  try {
    const row = db.query("SELECT * FROM items WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return {
      id: row.id as string,
      nodeId: row.node_id as string,
      kind: row.kind as string,
      title: row.title as string,
      state: row.state as string,
    };
  } finally {
    db.close();
  }
}

export function getNode(id: string): NodeInfo | null {
  const db = openDb();
  try {
    const row = db.query("SELECT * FROM nodes WHERE id = ?").get(id) as Record<
      string,
      unknown
    > | null;
    if (!row) return null;
    return {
      id: row.id as string,
      name: row.name as string,
      vertical: row.vertical as string,
      project: row.project as string,
      owner: row.owner as string,
    };
  } finally {
    db.close();
  }
}

export function getLocalNode(): NodeInfo | null {
  const candidates = [
    "./inv-config.json",
    "../inv-config.json",
    "../../inv-config.json",
  ];
  for (const c of candidates) {
    const resolved = resolve(c);
    if (existsSync(resolved)) {
      try {
        const config = JSON.parse(readFileSync(resolved, "utf-8"));
        if (config.node?.id) {
          return (
            getNode(config.node.id) ?? {
              id: config.node.id,
              name: config.node.name || "Unknown",
              vertical: config.node.vertical || "dev",
              project: config.node.project || "default",
              owner: config.node.owner || "unknown",
            }
          );
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

// ── Mutations ─────────────────────────────────────────────────────────

export function updatePendingActionStatus(
  id: string,
  status: PendingAction["status"],
): void {
  const db = openDb();
  try {
    db.query("UPDATE pending_actions SET status = ? WHERE id = ?").run(
      status,
      id,
    );
  } finally {
    db.close();
  }
}

export function castVote(
  crId: string,
  nodeId: string,
  vertical: string,
  approve: boolean,
  reason: string,
): void {
  const db = openDb();
  try {
    const id = crypto.randomUUID();
    db.query(
      "INSERT INTO votes (id, cr_id, node_id, vertical, approve, reason) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, crId, nodeId, vertical, approve ? 1 : 0, reason);
  } finally {
    db.close();
  }
}

// ── Stats ─────────────────────────────────────────────────────────────

export function getStats(): DashboardStats {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return {
      pendingCount: 0,
      votingCount: 0,
      challengeCount: 0,
      pairCount: 0,
      dbPath,
    };
  }
  const db = openDb();
  try {
    const pending =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM pending_actions WHERE status = 'pending'",
          )
          .get() as { c: number }
      )?.c ?? 0;
    const voting =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM change_requests WHERE status IN ('voting', 'proposed') AND description NOT LIKE 'Challenge:%'",
          )
          .get() as { c: number }
      )?.c ?? 0;
    const challenges =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM change_requests WHERE status IN ('voting', 'proposed') AND description LIKE 'Challenge:%'",
          )
          .get() as { c: number }
      )?.c ?? 0;
    const pairs =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM pair_sessions WHERE status = 'pending'",
          )
          .get() as { c: number }
      )?.c ?? 0;
    return {
      pendingCount: pending,
      votingCount: voting,
      challengeCount: challenges,
      pairCount: pairs,
      dbPath,
    };
  } finally {
    db.close();
  }
}
