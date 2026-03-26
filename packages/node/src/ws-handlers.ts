import type { Envelope, MessagePayload } from "@inv/shared";
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
        this.handleSignalChange(payload);
        break;
      case "sweep":
        this.handleSweep(payload);
        break;
      case "trace_resolve_request":
        this.handleTraceResolveRequest(payload);
        break;
      case "query_ask":
        this.handleQueryAsk(envelope, payload);
        break;
      case "query_respond":
        this.handleQueryRespond(payload);
        break;
      case "ack":
        // no-op
        break;
      case "error":
        console.error(`Remote error [${payload.code}]: ${payload.message}`);
        break;
    }

    this.eventBus.emit(payload.type as EventType, payload);
  }

  private handleSignalChange(
    payload: Extract<MessagePayload, { type: "signal_change" }>,
  ): void {
    try {
      this.engine.propagateChange(payload.itemId);
    } catch (err) {
      // Item may not exist locally — this is expected in distributed scenarios
      console.warn(`signal_change: could not propagate for item ${payload.itemId}:`, err);
    }
  }

  private handleSweep(
    payload: Extract<MessagePayload, { type: "sweep" }>,
  ): void {
    try {
      this.engine.sweep(payload.externalRef);
    } catch (err) {
      console.error(`sweep failed for ref ${payload.externalRef}:`, err);
    }
  }

  private handleTraceResolveRequest(
    payload: Extract<MessagePayload, { type: "trace_resolve_request" }>,
  ): void {
    try {
      const item = this.engine.getItem(payload.itemId);
      this.eventBus.emit("trace_resolve_response", {
        type: "trace_resolve_response",
        itemId: item.id,
        title: item.title,
        kind: item.kind,
        state: item.state,
      });
    } catch (err) {
      console.warn(`trace_resolve_request: item ${payload.itemId} not found locally:`, err);
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
    } catch (err) {
      console.error("Failed to create query:", err);
    }
  }

  private handleQueryRespond(
    payload: Extract<MessagePayload, { type: "query_respond" }>,
  ): void {
    console.log(`Query response from ${payload.responderId}: ${payload.answer}`);
  }
}
