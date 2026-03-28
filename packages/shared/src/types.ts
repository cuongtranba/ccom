export type Vertical = string;
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
export type TransitionKind = "verify" | "suspect" | "re_verify" | "break" | "fix";

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

export type ToolArgs =
  | { tool: "inv_add_item"; name: string; kind: ItemKind; vertical: Vertical; externalRef?: string }
  | { tool: "inv_add_trace"; fromItemId: string; toItemId: string; relation: TraceRelation }
  | { tool: "inv_verify"; itemId: string }
  | { tool: "inv_mark_broken"; itemId: string; reason?: string }
  | { tool: "inv_audit" }
  | { tool: "inv_ask"; question: string; targetNode?: string }
  | { tool: "inv_reply"; message: string; targetNode: string }
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
  | { tool: "inv_checklist_list"; itemId: string };
