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

export const UPSTREAM_VERTICALS: Record<Vertical, Vertical[]> = {
  pm: [],
  design: ["pm"],
  dev: ["pm", "design"],
  qa: ["dev"],
  devops: ["dev", "qa"],
};
