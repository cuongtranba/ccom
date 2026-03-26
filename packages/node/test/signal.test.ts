import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import type { Item, Signal } from "@inv/shared";

describe("SignalPropagator", () => {
  let store: Store;
  let sm: StateMachine;
  let propagator: SignalPropagator;

  // Helper: create a node and return its id
  function createNode(name: string): string {
    return store.createNode({
      name,
      vertical: "dev",
      project: "test-proj",
      owner: "tester",
      isAI: false,
    }).id;
  }

  // Helper: create an item on a node with a given title, return the item
  function createItem(nodeId: string, title: string): Item {
    return store.createItem({
      nodeId,
      kind: "decision",
      title,
    });
  }

  // Helper: make an item "proven" by verifying it through the store
  function proveItem(itemId: string): Item {
    return store.updateItemStatus(itemId, "proven", "verified", "tester");
  }

  // Helper: create a trace from downstream -> upstream (downstream depends on upstream)
  function traceDependency(
    downstreamItemId: string,
    downstreamNodeId: string,
    upstreamItemId: string,
    upstreamNodeId: string,
  ) {
    return store.createTrace({
      fromItemId: downstreamItemId,
      fromNodeId: downstreamNodeId,
      toItemId: upstreamItemId,
      toNodeId: upstreamNodeId,
      relation: "traced_from",
    });
  }

  beforeEach(() => {
    store = new Store(":memory:");
    sm = new StateMachine();
    propagator = new SignalPropagator(store, sm);
  });

  afterEach(() => {
    store.close();
  });

  // ── propagateChange ─────────────────────────────────────────────────

  describe("propagateChange", () => {
    it("marks downstream proven items as suspect", () => {
      const nodeId = createNode("Node A");
      const upstream = createItem(nodeId, "Upstream");
      const downstream = createItem(nodeId, "Downstream");
      proveItem(downstream.id);
      traceDependency(downstream.id, nodeId, upstream.id, nodeId);

      const signals = propagator.propagateChange(upstream.id);

      // Downstream should now be suspect
      const updated = store.getItem(downstream.id);
      expect(updated?.state).toBe("suspect");

      // Should have produced exactly one signal
      expect(signals).toHaveLength(1);
      expect(signals[0].kind).toBe("change");
      expect(signals[0].sourceItem).toBe(upstream.id);
      expect(signals[0].targetItem).toBe(downstream.id);
    });

    it("records a transition when marking items suspect", () => {
      const nodeId = createNode("Node A");
      const upstream = createItem(nodeId, "Upstream");
      const downstream = createItem(nodeId, "Downstream");
      proveItem(downstream.id);
      traceDependency(downstream.id, nodeId, upstream.id, nodeId);

      propagator.propagateChange(upstream.id);

      const transitions = store.getItemTransitions(downstream.id);
      // First transition is from the proveItem helper (unverified->proven)
      // Second transition is from propagation (proven->suspect)
      const suspectTransition = transitions.find((t) => t.to === "suspect");
      expect(suspectTransition).toBeDefined();
      expect(suspectTransition?.from).toBe("proven");
      expect(suspectTransition?.kind).toBe("suspect");
      expect(suspectTransition?.actor).toBe("signal-propagator");
    });

    it("skips non-proven downstream items", () => {
      const nodeId = createNode("Node A");
      const upstream = createItem(nodeId, "Upstream");
      const unverifiedItem = createItem(nodeId, "Unverified Downstream");
      // unverifiedItem stays "unverified" (default state)
      traceDependency(unverifiedItem.id, nodeId, upstream.id, nodeId);

      const signals = propagator.propagateChange(upstream.id);

      // No signals should be produced
      expect(signals).toHaveLength(0);

      // Item state should remain unverified
      const item = store.getItem(unverifiedItem.id);
      expect(item?.state).toBe("unverified");
    });

    it("cascades recursively (A -> B -> C)", () => {
      const nodeId = createNode("Node A");
      const itemA = createItem(nodeId, "Item A");
      const itemB = createItem(nodeId, "Item B");
      const itemC = createItem(nodeId, "Item C");

      // B and C are proven
      proveItem(itemB.id);
      proveItem(itemC.id);

      // B depends on A, C depends on B
      traceDependency(itemB.id, nodeId, itemA.id, nodeId);
      traceDependency(itemC.id, nodeId, itemB.id, nodeId);

      const signals = propagator.propagateChange(itemA.id);

      // Both B and C should become suspect
      expect(store.getItem(itemB.id)?.state).toBe("suspect");
      expect(store.getItem(itemC.id)?.state).toBe("suspect");

      // Should produce two signals (one for B, one for C)
      expect(signals).toHaveLength(2);
      const targetIds = signals.map((s) => s.targetItem).sort();
      expect(targetIds).toEqual([itemB.id, itemC.id].sort());
    });

    it("handles cycles without infinite loop", () => {
      const nodeId = createNode("Node A");
      const itemA = createItem(nodeId, "Item A");
      const itemB = createItem(nodeId, "Item B");

      proveItem(itemA.id);
      proveItem(itemB.id);

      // A depends on B AND B depends on A => cycle
      traceDependency(itemA.id, nodeId, itemB.id, nodeId);
      traceDependency(itemB.id, nodeId, itemA.id, nodeId);

      // Should not hang; A is the changed item so propagation starts from A
      // B depends on A -> B becomes suspect
      // A depends on B -> but A is already visited, skip
      const signals = propagator.propagateChange(itemA.id);

      expect(signals).toHaveLength(1);
      expect(signals[0].targetItem).toBe(itemB.id);
      expect(store.getItem(itemB.id)?.state).toBe("suspect");
    });

    it("returns empty array when no dependents exist", () => {
      const nodeId = createNode("Node A");
      const item = createItem(nodeId, "Standalone");

      const signals = propagator.propagateChange(item.id);
      expect(signals).toHaveLength(0);
    });

    it("handles multiple downstream dependents from one item", () => {
      const nodeId = createNode("Node A");
      const upstream = createItem(nodeId, "Upstream");
      const downA = createItem(nodeId, "Down A");
      const downB = createItem(nodeId, "Down B");

      proveItem(downA.id);
      proveItem(downB.id);

      traceDependency(downA.id, nodeId, upstream.id, nodeId);
      traceDependency(downB.id, nodeId, upstream.id, nodeId);

      const signals = propagator.propagateChange(upstream.id);

      expect(signals).toHaveLength(2);
      expect(store.getItem(downA.id)?.state).toBe("suspect");
      expect(store.getItem(downB.id)?.state).toBe("suspect");
    });
  });

  // ── computeImpact ───────────────────────────────────────────────────

  describe("computeImpact", () => {
    it("returns all downstream items without changing state", () => {
      const nodeId = createNode("Node A");
      const itemA = createItem(nodeId, "Item A");
      const itemB = createItem(nodeId, "Item B");
      const itemC = createItem(nodeId, "Item C");

      proveItem(itemB.id);
      proveItem(itemC.id);

      traceDependency(itemB.id, nodeId, itemA.id, nodeId);
      traceDependency(itemC.id, nodeId, itemB.id, nodeId);

      const impacted = propagator.computeImpact(itemA.id);

      // Both B and C should be in the impact list
      expect(impacted).toHaveLength(2);
      const impactedIds = impacted.map((i) => i.id).sort();
      expect(impactedIds).toEqual([itemB.id, itemC.id].sort());

      // State should NOT be changed
      expect(store.getItem(itemB.id)?.state).toBe("proven");
      expect(store.getItem(itemC.id)?.state).toBe("proven");
    });

    it("returns empty for items with no dependents", () => {
      const nodeId = createNode("Node A");
      const item = createItem(nodeId, "Standalone");

      const impacted = propagator.computeImpact(item.id);
      expect(impacted).toHaveLength(0);
    });

    it("handles cycles without infinite loop", () => {
      const nodeId = createNode("Node A");
      const itemA = createItem(nodeId, "Item A");
      const itemB = createItem(nodeId, "Item B");

      proveItem(itemA.id);
      proveItem(itemB.id);

      traceDependency(itemA.id, nodeId, itemB.id, nodeId);
      traceDependency(itemB.id, nodeId, itemA.id, nodeId);

      const impacted = propagator.computeImpact(itemA.id);

      // B depends on A, so B is impacted. A depends on B but A is the source, so it's already visited.
      expect(impacted).toHaveLength(1);
      expect(impacted[0].id).toBe(itemB.id);

      // States unchanged
      expect(store.getItem(itemA.id)?.state).toBe("proven");
      expect(store.getItem(itemB.id)?.state).toBe("proven");
    });

    it("includes items in any state (not just proven)", () => {
      const nodeId = createNode("Node A");
      const upstream = createItem(nodeId, "Upstream");
      const provenItem = createItem(nodeId, "Proven");
      const unverifiedItem = createItem(nodeId, "Unverified");

      proveItem(provenItem.id);
      // unverifiedItem stays unverified

      traceDependency(provenItem.id, nodeId, upstream.id, nodeId);
      traceDependency(unverifiedItem.id, nodeId, upstream.id, nodeId);

      const impacted = propagator.computeImpact(upstream.id);

      // Both items are downstream, regardless of their state
      expect(impacted).toHaveLength(2);
      const impactedIds = impacted.map((i) => i.id).sort();
      expect(impactedIds).toEqual([provenItem.id, unverifiedItem.id].sort());
    });
  });
});
