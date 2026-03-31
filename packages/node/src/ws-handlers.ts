import type { Envelope } from "@inv/shared";
import type { EventBus, EventType } from "./event-bus";

export class WSHandlers {
  constructor(private eventBus: EventBus) {}

  handle(envelope: Envelope): void {
    const { payload } = envelope;
    this.eventBus.emit(payload.type as EventType, {
      ...payload,
      fromNode: envelope.fromNode,
    });
  }
}
