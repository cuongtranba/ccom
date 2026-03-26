import { describe, it, expect } from "bun:test";
import { EventBus } from "../src/event-bus";

describe("EventBus", () => {
  it("on + emit fires handler", () => {
    const bus = new EventBus();
    let received: unknown = null;

    bus.on("signal_change", (data) => {
      received = data;
    });

    bus.emit("signal_change", { itemId: "abc" });

    expect(received).toEqual({ itemId: "abc" });
  });

  it("multiple listeners all fire", () => {
    const bus = new EventBus();
    const calls: number[] = [];

    bus.on("sweep", () => calls.push(1));
    bus.on("sweep", () => calls.push(2));
    bus.on("sweep", () => calls.push(3));

    bus.emit("sweep", {});

    expect(calls).toEqual([1, 2, 3]);
  });

  it("off removes listener", () => {
    const bus = new EventBus();
    let callCount = 0;

    const handler = () => {
      callCount++;
    };

    bus.on("ack", handler);
    bus.emit("ack", {});
    expect(callCount).toBe(1);

    bus.off("ack", handler);
    bus.emit("ack", {});
    expect(callCount).toBe(1);
  });

  it("emit with no listeners does not throw", () => {
    const bus = new EventBus();

    expect(() => bus.emit("error", { message: "test" })).not.toThrow();
  });

  it("off on non-existent event does not throw", () => {
    const bus = new EventBus();
    const handler = () => {};

    expect(() => bus.off("query_ask", handler)).not.toThrow();
  });

  it("different events are independent", () => {
    const bus = new EventBus();
    let signalFired = false;
    let sweepFired = false;

    bus.on("signal_change", () => {
      signalFired = true;
    });
    bus.on("sweep", () => {
      sweepFired = true;
    });

    bus.emit("signal_change", {});

    expect(signalFired).toBe(true);
    expect(sweepFired).toBe(false);
  });
});
