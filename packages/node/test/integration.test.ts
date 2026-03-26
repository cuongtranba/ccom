import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import { WSHandlers } from "../src/ws-handlers";
import { EventBus } from "../src/event-bus";
import type { EventType } from "../src/event-bus";
import { createEnvelope } from "@inv/shared";

describe("Integration", () => {
  let store: Store;
  let sm: StateMachine;
  let propagator: SignalPropagator;
  let engine: Engine;

  beforeEach(() => {
    store = new Store(":memory:");
    sm = new StateMachine();
    propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);
  });

  afterEach(() => {
    store.close();
  });

  // ── Test 1 ────────────────────────────────────────────────────────────────
  it("full lifecycle: register -> add items -> trace -> verify -> propagate", () => {
    // 1. Register two nodes (dev, pm) in same project
    const devNode = engine.registerNode("dev-node", "dev", "proj-alpha", "alice", false);
    const pmNode = engine.registerNode("pm-node", "pm", "proj-alpha", "bob", false);

    const nodes = engine.listNodes("proj-alpha");
    expect(nodes).toHaveLength(2);

    // 2. Add items: PRD (pm), ADR (dev), API Spec (dev)
    const prd = engine.addItem(pmNode.id, "prd", "Product Requirements", "Full PRD body");
    const adr = engine.addItem(devNode.id, "adr", "Architecture Decision Record", "ADR body");
    const spec = engine.addItem(devNode.id, "api-spec", "API Specification", "OpenAPI spec");

    expect(prd.state).toBe("unverified");
    expect(adr.state).toBe("unverified");
    expect(spec.state).toBe("unverified");

    // 3. Create traces: spec -> adr -> prd (spec depends on adr, adr depends on prd)
    //    "from" depends on "to": fromItemId traces to toItemId
    engine.addTrace(spec.id, adr.id, "traced_from", "alice");
    engine.addTrace(adr.id, prd.id, "traced_from", "alice");

    // 4. Verify all items (proven)
    engine.verifyItem(prd.id, "PRD reviewed and approved", "bob");
    engine.verifyItem(adr.id, "ADR reviewed by team", "alice");
    engine.verifyItem(spec.id, "Spec validated against ADR", "alice");

    expect(engine.getItem(prd.id).state).toBe("proven");
    expect(engine.getItem(adr.id).state).toBe("proven");
    expect(engine.getItem(spec.id).state).toBe("proven");

    // 5. Re-verify the PRD (simulates PRD changing) -- triggers propagation
    //    First, move PRD to suspect (simulating an upstream change),
    //    then re-verify it which triggers propagation to downstream items.
    store.updateItemStatus(prd.id, "suspect", "requirements-changed", "system");
    store.recordTransition({
      itemId: prd.id,
      kind: "suspect",
      from: "proven",
      to: "suspect",
      evidence: "requirements-changed",
      actor: "system",
    });
    const signals = engine.verifyItem(prd.id, "PRD updated and re-approved", "bob");

    // 6. Assert: ADR becomes suspect, Spec becomes suspect (cascade)
    const updatedAdr = engine.getItem(adr.id);
    const updatedSpec = engine.getItem(spec.id);
    expect(updatedAdr.state).toBe("suspect");
    expect(updatedSpec.state).toBe("suspect");
    expect(signals.length).toBeGreaterThanOrEqual(2);

    // 7. Run impact check on PRD -- returns ADR + Spec
    //    Impact is read-only and checks all downstream items regardless of state
    const impacted = engine.impact(prd.id);
    expect(impacted).toHaveLength(2);
    const impactedIds = impacted.map((i) => i.id);
    expect(impactedIds).toContain(adr.id);
    expect(impactedIds).toContain(spec.id);

    // 8. Run audit on dev node -- shows 2 suspect items
    const report = engine.audit(devNode.id);
    expect(report.totalItems).toBe(2);
    expect(report.suspect).toHaveLength(2);
    expect(report.suspect).toContain(adr.id);
    expect(report.suspect).toContain(spec.id);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  it("sweep finds items by external ref and propagates", () => {
    // 1. Register node, add item with externalRef "PRD-001", verify it
    const node = engine.registerNode("pm-node", "pm", "proj-beta", "carol", false);
    const prd = engine.addItem(node.id, "prd", "Product Spec", "Body", "PRD-001");
    engine.verifyItem(prd.id, "Approved by stakeholders", "carol");
    expect(engine.getItem(prd.id).state).toBe("proven");

    // 2. Add downstream item, verify, create trace
    const downstream = engine.addItem(node.id, "user-story", "User Story A", "Story body");
    engine.verifyItem(downstream.id, "Story reviewed", "carol");
    expect(engine.getItem(downstream.id).state).toBe("proven");

    // Trace: downstream depends on prd
    engine.addTrace(downstream.id, prd.id, "traced_from", "carol");

    // 3. Call engine.sweep("PRD-001")
    const result = engine.sweep("PRD-001");

    // 4. Assert: matched items, affected items, downstream becomes suspect
    expect(result.triggerRef).toBe("PRD-001");
    expect(result.matchedItems).toHaveLength(1);
    expect(result.matchedItems[0].id).toBe(prd.id);
    expect(result.affectedItems.length).toBeGreaterThanOrEqual(1);
    expect(result.signalsCreated).toBeGreaterThanOrEqual(1);

    const updatedDownstream = engine.getItem(downstream.id);
    expect(updatedDownstream.state).toBe("suspect");
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  it("event bus fires on incoming message", () => {
    // 1. Register node, set up event bus listener
    const node = engine.registerNode("dev-node", "dev", "proj-gamma", "dave", false);
    const eventBus = new EventBus();
    const handlers = new WSHandlers(engine, store, eventBus);

    let firedPayload: unknown = null;
    let firedCount = 0;

    eventBus.on("query_ask", (data) => {
      firedPayload = data;
      firedCount++;
    });

    // 2. Create Envelope with query_ask payload
    const envelope = createEnvelope(
      "remote-node",
      node.id,
      "proj-gamma",
      { type: "query_ask", question: "What is the API endpoint?", askerId: "user-42" },
    );

    // 3. Pass to WSHandlers.handle()
    handlers.handle(envelope);

    // 4. Assert: event bus fired, query was stored
    expect(firedCount).toBe(1);
    expect(firedPayload).not.toBeNull();
    const payload = firedPayload as { type: string; question: string; askerId: string };
    expect(payload.type).toBe("query_ask");
    expect(payload.question).toBe("What is the API endpoint?");
    expect(payload.askerId).toBe("user-42");
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  it("pending actions workflow", () => {
    // 1. Create a pending action via store
    const action = store.createPendingAction({
      messageType: "signal_change",
      envelope: JSON.stringify({ some: "data" }),
      summary: "Item X changed upstream",
      proposed: "Mark downstream as suspect",
    });

    expect(action.status).toBe("pending");
    expect(action.id).toBeDefined();

    // 2. List pending -- returns it
    const pendingBefore = store.listPendingActions();
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0].id).toBe(action.id);
    expect(pendingBefore[0].summary).toBe("Item X changed upstream");

    // 3. Update status to approved
    store.updatePendingActionStatus(action.id, "approved");

    // 4. List pending -- empty (only returns pending)
    const pendingAfter = store.listPendingActions();
    expect(pendingAfter).toHaveLength(0);
  });
});
