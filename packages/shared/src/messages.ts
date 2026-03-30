import { randomUUID } from "crypto";
import type { ToolArgs } from "./types";

export interface Envelope {
  messageId: string;
  fromNode: string;
  toNode: string;
  projectId: string;
  timestamp: string;
  payload: MessagePayload;
}

export type MessagePayload =
  | { type: "signal_change"; itemId: string; oldState: string; newState: string; itemTitle?: string }
  | { type: "sweep"; externalRef: string; newValue: string }
  | { type: "trace_resolve_request"; itemId: string }
  | { type: "trace_resolve_response"; itemId: string; title: string; kind: string; state: string }
  | { type: "query_ask"; question: string; askerId: string }
  | { type: "query_respond"; answer: string; responderId: string; replyTo?: string }
  | { type: "ack"; originalMessageId: string }
  | ({ type: "permission_request"; requestId: string } & ToolArgs)
  | { type: "permission_verdict"; requestId: string; allowed: boolean; reason?: string }
  | { type: "proposal_create"; crId: string; targetItemId: string; description: string; proposerNode: string; targetItemTitle?: string; proposerNodeName?: string; pendingVoters?: string[] }
  | { type: "proposal_vote"; crId: string; approve: boolean; reason: string; voterNodeName?: string }
  | { type: "proposal_result"; crId: string; approved: boolean; tally: { approved: number; rejected: number; total: number } }
  | { type: "challenge_create"; challengeId: string; targetItemId: string; reason: string; challengerNode: string; targetItemTitle?: string; challengerNodeName?: string; pendingVoters?: string[] }
  | { type: "checklist_update"; itemId: string; checklistItemId: string; checked: boolean }
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
    throw new Error("Invalid envelope");
  }
  return parsed as Envelope;
}
