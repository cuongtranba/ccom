import type { Item, Signal } from "@inv/shared";
import type { Store } from "./store";
import type { StateMachine } from "./state";

export class SignalPropagator {
  constructor(
    private store: Store,
    private sm: StateMachine,
  ) {}

  /**
   * Recursively propagates status changes to dependent items.
   * For each downstream item that is "proven", transitions it to "suspect",
   * records the transition, creates a signal, and recurses.
   */
  propagateChange(changedItemId: string): Signal[] {
    const visited = new Set<string>();
    const signals: Signal[] = [];
    this.propagateRecursive(changedItemId, visited, signals);
    return signals;
  }

  /**
   * Read-only: returns all downstream items that would be affected
   * by a change to the given item. Does NOT change any state.
   */
  computeImpact(itemId: string): Item[] {
    const visited = new Set<string>();
    const impacted: Item[] = [];
    this.collectImpactRecursive(itemId, visited, impacted);
    return impacted;
  }

  private propagateRecursive(
    itemId: string,
    visited: Set<string>,
    signals: Signal[],
  ): void {
    visited.add(itemId);

    const dependentTraces = this.store.getDependentTraces(itemId);

    for (const trace of dependentTraces) {
      const downstreamId = trace.fromItemId;

      if (visited.has(downstreamId)) {
        continue;
      }

      const downstreamItem = this.store.getItem(downstreamId);
      if (!downstreamItem) {
        continue;
      }

      if (
        downstreamItem.state === "proven" &&
        this.sm.canTransition("proven", "suspect")
      ) {
        this.store.updateItemStatus(
          downstreamId,
          "suspect",
          "upstream-change",
          "signal-propagator",
        );

        this.store.recordTransition({
          itemId: downstreamId,
          kind: "suspect",
          from: "proven",
          to: "suspect",
          evidence: "upstream-change",
          reason: `Upstream item ${itemId} changed`,
          actor: "signal-propagator",
        });

        const signal = this.store.createSignal({
          kind: "change",
          sourceItem: itemId,
          sourceNode: trace.toNodeId,
          targetItem: downstreamId,
          targetNode: trace.fromNodeId,
          payload: `Propagated change from ${itemId}`,
        });

        signals.push(signal);

        this.propagateRecursive(downstreamId, visited, signals);
      }
    }
  }

  private collectImpactRecursive(
    itemId: string,
    visited: Set<string>,
    impacted: Item[],
  ): void {
    visited.add(itemId);

    const dependentTraces = this.store.getDependentTraces(itemId);

    for (const trace of dependentTraces) {
      const downstreamId = trace.fromItemId;

      if (visited.has(downstreamId)) {
        continue;
      }

      const downstreamItem = this.store.getItem(downstreamId);
      if (!downstreamItem) {
        continue;
      }

      impacted.push(downstreamItem);
      this.collectImpactRecursive(downstreamId, visited, impacted);
    }
  }
}
