import type { Envelope, MessagePayload } from "@inv/shared";
import type { Engine } from "./engine";
import type { Store } from "./store";
import type { EventBus, EventType } from "./event-bus";

export type SendFn = (toNode: string, payload: MessagePayload) => void;

export class WSHandlers {
  private sendFn: SendFn | null = null;

  constructor(
    private engine: Engine,
    private store: Store,
    private eventBus: EventBus,
  ) {}

  setSendFn(fn: SendFn): void {
    this.sendFn = fn;
  }

  handle(envelope: Envelope): void {
    const { payload } = envelope;

    switch (payload.type) {
      case "signal_change":
        this.handleSignalChange(payload);
        break;
      case "sweep":
        this.handleSweep(payload);
        break;
      case "trace_resolve_request":
        this.handleTraceResolveRequest(envelope, payload);
        break;
      case "query_ask":
        this.handleQueryAsk(envelope, payload);
        break;
      case "query_respond":
        this.handleQueryRespond(payload);
        break;
      case "permission_request":
      case "permission_verdict":
      case "proposal_create":
      case "proposal_vote":
      case "proposal_result":
      case "challenge_create":
      case "checklist_update":
        // Forwarded to Claude Code via channel server's EventBus listener
        break;
      case "ack":
        // no-op
        break;
      case "error":
        // Remote errors are forwarded via eventBus.emit below
        break;
    }

    this.eventBus.emit(payload.type as EventType, {
      ...payload,
      fromNode: envelope.fromNode,
    });
  }

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

  private handleSweep(
    payload: Extract<MessagePayload, { type: "sweep" }>,
  ): void {
    try {
      this.engine.sweep(payload.externalRef);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.eventBus.emit("error", {
        type: "error",
        code: "SWEEP_FAILED",
        message: `sweep for ref ${payload.externalRef}: ${message}`,
      });
    }
  }

  private handleTraceResolveRequest(
    envelope: Envelope,
    payload: Extract<MessagePayload, { type: "trace_resolve_request" }>,
  ): void {
    try {
      const item = this.engine.getItem(payload.itemId);
      const response: Extract<MessagePayload, { type: "trace_resolve_response" }> = {
        type: "trace_resolve_response",
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        state: item.state,
      };
      this.eventBus.emit("trace_resolve_response", response);

      // Send response back to the requesting node
      if (this.sendFn) {
        this.sendFn(envelope.fromNode, response);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.eventBus.emit("error", {
        type: "error",
        code: "TRACE_RESOLVE_FAILED",
        message: `trace_resolve_request for item ${payload.itemId}: ${message}`,
      });
    }
  }

  private handleQueryAsk(
    envelope: Envelope,
    payload: Extract<MessagePayload, { type: "query_ask" }>,
  ): void {
    try {
      this.store.createQuery({
        askerId: payload.askerId,
        askerNode: envelope.fromNode,
        question: payload.question,
      });
      // Question is forwarded to Claude via eventBus.emit at end of handle().
      // Claude can respond using inv_reply.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.eventBus.emit("error", {
        type: "error",
        code: "QUERY_ASK_FAILED",
        message: `query_ask: ${message}`,
      });
    }
  }

  private handleQueryRespond(
    payload: Extract<MessagePayload, { type: "query_respond" }>,
  ): void {
    // No-op: response is forwarded via eventBus.emit at the end of handle()
  }
}
