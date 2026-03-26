import type {
  Node,
  Item,
  Trace,
  Signal,
  Query,
  QueryResponse,
  AuditReport,
  ItemKind,
  TraceRelation,
  Vertical,
  TransitionKind,
} from "@inv/shared";
import type { Store } from "./store";
import type { StateMachine } from "./state";
import type { SignalPropagator } from "./signal";

export interface SweepResult {
  triggerRef: string;
  matchedItems: Item[];
  affectedItems: Item[];
  signalsCreated: number;
}

export class Engine {
  constructor(
    private store: Store,
    private sm: StateMachine,
    private propagator: SignalPropagator,
  ) {}

  // ── Nodes ───────────────────────────────────────────────────────────

  registerNode(
    name: string,
    vertical: Vertical,
    project: string,
    owner: string,
    isAI: boolean,
  ): Node {
    return this.store.createNode({ name, vertical, project, owner, isAI });
  }

  getNode(id: string): Node {
    const node = this.store.getNode(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    return node;
  }

  listNodes(project: string): Node[] {
    return this.store.listNodes(project);
  }

  // ── Items ───────────────────────────────────────────────────────────

  addItem(
    nodeId: string,
    kind: ItemKind,
    title: string,
    body?: string,
    externalRef?: string,
  ): Item {
    // Validate node exists
    const node = this.store.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    return this.store.createItem({ nodeId, kind, title, body, externalRef });
  }

  getItem(id: string): Item {
    const item = this.store.getItem(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    return item;
  }

  listItems(nodeId: string): Item[] {
    return this.store.listItems(nodeId);
  }

  // ── Traces ──────────────────────────────────────────────────────────

  addTrace(
    fromItemId: string,
    toItemId: string,
    relation: TraceRelation,
    actor: string,
  ): Trace {
    const fromItem = this.store.getItem(fromItemId);
    if (!fromItem) throw new Error(`Item not found: ${fromItemId}`);

    const toItem = this.store.getItem(toItemId);
    if (!toItem) throw new Error(`Item not found: ${toItemId}`);

    return this.store.createTrace({
      fromItemId,
      fromNodeId: fromItem.nodeId,
      toItemId,
      toNodeId: toItem.nodeId,
      relation,
    });
  }

  // ── State Transitions ─────────────────────────────────────────────

  verifyItem(itemId: string, evidence: string, actor: string): Signal[] {
    const item = this.getItem(itemId);

    // Determine transition kind based on current state
    let kind: TransitionKind;
    switch (item.state) {
      case "unverified":
        kind = "verify";
        break;
      case "suspect":
        kind = "re_verify";
        break;
      case "broke":
        kind = "fix";
        break;
      default:
        throw new Error(
          `Cannot verify item in state "${item.state}": no valid transition`,
        );
    }

    const newState = this.sm.apply(item.state, kind);

    this.store.updateItemStatus(itemId, newState, evidence, actor);

    this.store.recordTransition({
      itemId,
      kind,
      from: item.state,
      to: newState,
      evidence,
      actor,
    });

    return this.propagator.propagateChange(itemId);
  }

  markBroken(itemId: string, reason: string, actor: string): void {
    const item = this.getItem(itemId);

    if (item.state !== "suspect") {
      throw new Error(
        `Cannot mark item as broken: item is in "${item.state}" state, must be "suspect"`,
      );
    }

    const newState = this.sm.apply(item.state, "break");

    this.store.updateItemStatus(itemId, newState, reason, actor);

    this.store.recordTransition({
      itemId,
      kind: "break",
      from: item.state,
      to: newState,
      reason,
      actor,
    });
  }

  // ── Signals & Impact ──────────────────────────────────────────────

  propagateChange(itemId: string): Signal[] {
    return this.propagator.propagateChange(itemId);
  }

  impact(itemId: string): Item[] {
    return this.propagator.computeImpact(itemId);
  }

  // ── Queries ───────────────────────────────────────────────────────

  ask(
    askerId: string,
    askerNode: string,
    question: string,
    context?: string,
    targetNode?: string,
  ): Query {
    return this.store.createQuery({
      askerId,
      askerNode,
      question,
      context,
      targetNode,
    });
  }

  respond(
    queryId: string,
    responderId: string,
    nodeId: string,
    answer: string,
    isAI: boolean,
  ): QueryResponse {
    return this.store.createQueryResponse({
      queryId,
      responderId,
      nodeId,
      answer,
      isAI,
    });
  }

  // ── Audit ─────────────────────────────────────────────────────────

  audit(nodeId: string): AuditReport {
    return this.store.audit(nodeId);
  }

  // ── Sweep ─────────────────────────────────────────────────────────

  sweep(externalRef: string): SweepResult {
    const matchedItems = this.store.findItemsByExternalRef(externalRef);
    const allSignals: Signal[] = [];
    const affectedItemIds = new Set<string>();

    for (const item of matchedItems) {
      const signals = this.propagator.propagateChange(item.id);
      for (const signal of signals) {
        allSignals.push(signal);
        affectedItemIds.add(signal.targetItem);
      }
    }

    const affectedItems: Item[] = [];
    for (const id of affectedItemIds) {
      const item = this.store.getItem(id);
      if (item) {
        affectedItems.push(item);
      }
    }

    return {
      triggerRef: externalRef,
      matchedItems,
      affectedItems,
      signalsCreated: allSignals.length,
    };
  }
}
