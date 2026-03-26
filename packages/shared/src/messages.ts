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
  | { type: "trace_resolve_response"; itemId: string; title: string; kind: string; state: string }
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
    throw new Error("Invalid envelope");
  }
  return parsed as Envelope;
}
