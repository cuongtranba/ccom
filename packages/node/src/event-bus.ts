export type EventType = "query_ask" | "query_respond" | "ack" | "error";

type EventHandler = (data: unknown) => void;

export class EventBus {
	private listeners = new Map<EventType, Set<EventHandler>>();

	on(event: EventType, handler: EventHandler): void {
		let handlers = this.listeners.get(event);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(event, handlers);
		}
		handlers.add(handler);
	}

	off(event: EventType, handler: EventHandler): void {
		const handlers = this.listeners.get(event);
		if (handlers) {
			handlers.delete(handler);
		}
	}

	emit(event: EventType, data: unknown): void {
		const handlers = this.listeners.get(event);
		if (!handlers) return;
		for (const handler of handlers) {
			handler(data);
		}
	}
}
