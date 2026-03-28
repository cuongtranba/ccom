import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import { EventBus } from "../src/event-bus";
import { WSHandlers } from "../src/ws-handlers";
import type { Node, Item, Vertical } from "@inv/shared";

// ── Test Harness ────────────────────────────────────────────────────────

interface TestNode {
  node: Node;
  engine: Engine;
  store: Store;
  eventBus: EventBus;
  wsHandlers: WSHandlers;
}

/**
 * Creates a full node stack (store, engine, event bus) for a given vertical.
 * Each node gets its own in-memory SQLite database to simulate distributed nodes.
 */
function createTestNode(
  name: string,
  vertical: Vertical,
  project: string,
  owner: string,
): TestNode {
  const store = new Store(":memory:");
  const sm = new StateMachine();
  const propagator = new SignalPropagator(store, sm);
  const engine = new Engine(store, sm, propagator);
  const eventBus = new EventBus();
  const wsHandlers = new WSHandlers(engine, store, eventBus);

  const node = engine.registerNode(name, vertical, project, owner, false);

  return { node, engine, store, eventBus, wsHandlers };
}

/**
 * Simulates cross-node item registration.
 * In a real system, items from other nodes are synced via WebSocket.
 * For testing, we register the remote item locally so traces can reference it.
 */
function registerRemoteItem(
  localStore: Store,
  remoteItem: Item,
  remoteNode: Node,
): Item {
  // Ensure remote node exists locally
  if (!localStore.getNode(remoteNode.id)) {
    localStore.createNode({
      name: remoteNode.name,
      vertical: remoteNode.vertical,
      project: remoteNode.project,
      owner: remoteNode.owner,
      isAI: remoteNode.isAI,
    });
    // Overwrite with the correct ID since createNode generates a new one
    // We need a workaround: create the item directly referencing the remote node
  }
  return remoteItem;
}

// ── Shared Project Setup ────────────────────────────────────────────────

const PROJECT = "clinic-checkin";

describe("Scenario: Full Project Lifecycle (all verticals)", () => {
  // One shared store to simulate a connected network
  let store: Store;
  let sm: StateMachine;
  let propagator: SignalPropagator;
  let engine: Engine;
  let eventBus: EventBus;

  // Node references
  let pmNode: Node;
  let designNode: Node;
  let devNode: Node;
  let qaNode: Node;
  let devopsNode: Node;

  // Item references
  let prd: Item;
  let userStory: Item;
  let screenSpec: Item;
  let userFlow: Item;
  let apiSpec: Item;
  let techDesign: Item;
  let dataModel: Item;
  let testPlan: Item;
  let testCase: Item;
  let runbook: Item;
  let bugReport: Item;

  beforeEach(() => {
    // Single shared store simulates a fully connected network
    store = new Store(":memory:");
    sm = new StateMachine();
    propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);
    eventBus = new EventBus();

    // Register all 5 vertical nodes
    pmNode = engine.registerNode("pm-node", "pm", PROJECT, "alice", false);
    designNode = engine.registerNode("design-node", "design", PROJECT, "bob", false);
    devNode = engine.registerNode("dev-node", "dev", PROJECT, "cuong", false);
    qaNode = engine.registerNode("qa-node", "qa", PROJECT, "diana", false);
    devopsNode = engine.registerNode("devops-node", "devops", PROJECT, "eve", false);
  });

  afterEach(() => {
    store.close();
  });

  // ── PM Scenarios ────────────────────────────────────────────────────

  describe("PM: creates foundational items", () => {
    beforeEach(() => {
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "Patient self-service check-in", "JIRA-101");
      userStory = engine.addItem(pmNode.id, "user-story", "Patient scans QR code to check in", "As a patient I want to scan a QR code", "JIRA-102");
    });

    it("creates PRD and user story in unverified state", () => {
      expect(prd.state).toBe("unverified");
      expect(prd.kind).toBe("prd");
      expect(prd.nodeId).toBe(pmNode.id);

      expect(userStory.state).toBe("unverified");
      expect(userStory.kind).toBe("user-story");
    });

    it("PM verifies own items", () => {
      const signals = engine.verifyItem(prd.id, "Approved by stakeholders", "alice");
      const updated = engine.getItem(prd.id);
      expect(updated.state).toBe("proven");
      expect(updated.confirmedBy).toBe("alice");
    });

    it("PM audit shows no missing upstream refs (vertical hierarchy removed)", () => {
      const report = engine.audit(pmNode.id);
      expect(report.totalItems).toBe(2);
      expect(report.unverified).toHaveLength(2);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });

    it("PM items are orphans until traced", () => {
      const report = engine.audit(pmNode.id);
      expect(report.orphans).toHaveLength(2);
    });

    it("PM traces user story from PRD, removing orphan status", () => {
      engine.addTrace(userStory.id, prd.id, "traced_from", "alice");

      const report = engine.audit(pmNode.id);
      // Both items now have traces — neither is an orphan
      expect(report.orphans).toHaveLength(0);
    });
  });

  // ── Design Scenarios ──────────────────────────────────────────────────

  describe("Design: creates specs traced from PM items", () => {
    beforeEach(() => {
      // PM setup
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
      userStory = engine.addItem(pmNode.id, "user-story", "Patient scans QR code", "", "JIRA-102");
      engine.verifyItem(prd.id, "Stakeholder approved", "alice");
      engine.verifyItem(userStory.id, "Stakeholder approved", "alice");

      // Design creates items
      screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Scanner Screen", "Full-screen camera with overlay", "FIGMA-201");
      userFlow = engine.addItem(designNode.id, "user-flow", "Check-In Flow", "Scan → Verify → Confirm → Done", "FIGMA-202");
    });

    it("Design items start unverified", () => {
      expect(screenSpec.state).toBe("unverified");
      expect(screenSpec.nodeId).toBe(designNode.id);
      expect(userFlow.kind).toBe("user-flow");
    });

    it("Design traces screen spec from user story", () => {
      const trace = engine.addTrace(screenSpec.id, userStory.id, "traced_from", "bob");
      expect(trace.fromItemId).toBe(screenSpec.id);
      expect(trace.toItemId).toBe(userStory.id);
      expect(trace.fromNodeId).toBe(designNode.id);
      expect(trace.toNodeId).toBe(pmNode.id);
    });

    it("Design audit has no missing upstream refs (vertical hierarchy removed)", () => {
      // Vertical is now a free-form string — no fixed upstream hierarchy.
      // missingUpstreamRefs is always [] regardless of traces.
      const report = engine.audit(designNode.id);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });

    it("PM change propagates to Design's proven items", () => {
      // Verify design items and trace them
      engine.verifyItem(screenSpec.id, "Design review passed", "bob");
      engine.addTrace(screenSpec.id, userStory.id, "traced_from", "bob");

      // PM changes user story (propagate from user story)
      const signals = engine.propagateChange(userStory.id);

      const updated = engine.getItem(screenSpec.id);
      expect(updated.state).toBe("suspect");
      expect(signals).toHaveLength(1);
      expect(signals[0].targetItem).toBe(screenSpec.id);
      expect(signals[0].targetNode).toBe(designNode.id);
    });
  });

  // ── Dev Scenarios ─────────────────────────────────────────────────────

  describe("Dev: creates technical items traced from PM and Design", () => {
    beforeEach(() => {
      // PM setup
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
      userStory = engine.addItem(pmNode.id, "user-story", "Patient scans QR code", "", "JIRA-102");
      engine.verifyItem(prd.id, "Approved", "alice");
      engine.verifyItem(userStory.id, "Approved", "alice");

      // Design setup
      screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Scanner Screen", "", "FIGMA-201");
      engine.verifyItem(screenSpec.id, "Design review passed", "bob");
      engine.addTrace(screenSpec.id, userStory.id, "traced_from", "bob");

      // Dev creates items
      apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "POST /check-in, GET /status", "");
      techDesign = engine.addItem(devNode.id, "tech-design", "QR Verification Service", "Uses camera API + backend validation", "");
      dataModel = engine.addItem(devNode.id, "data-model", "CheckIn Entity", "patient_id, appointment_id, checked_in_at", "");
    });

    it("Dev creates items in correct vertical", () => {
      expect(apiSpec.nodeId).toBe(devNode.id);
      expect(techDesign.kind).toBe("tech-design");
      expect(dataModel.kind).toBe("data-model");
    });

    it("Dev traces API spec from PRD and screen spec", () => {
      const traceFromPrd = engine.addTrace(apiSpec.id, prd.id, "traced_from", "cuong");
      const traceFromDesign = engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");

      expect(traceFromPrd.fromNodeId).toBe(devNode.id);
      expect(traceFromPrd.toNodeId).toBe(pmNode.id);
      expect(traceFromDesign.toNodeId).toBe(designNode.id);
    });

    it("Dev audit has no missing upstream refs (vertical hierarchy removed)", () => {
      // Vertical is now a free-form string — no fixed upstream hierarchy.
      // missingUpstreamRefs is always [] regardless of traces.
      const report = engine.audit(devNode.id);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });

    it("PM PRD change cascades PM → Design → Dev", () => {
      // Verify dev items
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      engine.verifyItem(techDesign.id, "Arch review", "cuong");

      // Trace: apiSpec ← screenSpec ← userStory ← prd
      engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");

      // Propagate from user story (PM changes requirements)
      const signals = engine.propagateChange(userStory.id);

      // screenSpec (Design) should be suspect
      expect(engine.getItem(screenSpec.id).state).toBe("suspect");

      // apiSpec (Dev) should also be suspect (cascaded through screenSpec)
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");

      // At least 2 signals: one for screenSpec, one for apiSpec
      expect(signals.length).toBeGreaterThanOrEqual(2);
    });

    it("Dev re-verifies after upstream change", () => {
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");

      // Cascade from PM change
      engine.propagateChange(userStory.id);
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");

      // Dev reviews and re-verifies
      const signals = engine.verifyItem(apiSpec.id, "Reviewed against new requirements, still valid", "cuong");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");

      const transitions = store.getItemTransitions(apiSpec.id);
      const reVerify = transitions.find((t) => t.kind === "re_verify");
      expect(reVerify).toBeDefined();
      expect(reVerify?.from).toBe("suspect");
      expect(reVerify?.to).toBe("proven");
    });
  });

  // ── QA Scenarios ──────────────────────────────────────────────────────

  describe("QA: creates test items traced from Dev", () => {
    beforeEach(() => {
      // PM → Design → Dev chain
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
      engine.verifyItem(prd.id, "Approved", "alice");

      screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Scanner Screen", "", "FIGMA-201");
      engine.verifyItem(screenSpec.id, "Design reviewed", "bob");
      engine.addTrace(screenSpec.id, prd.id, "traced_from", "bob");

      apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "", "");
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");

      // QA creates items
      testPlan = engine.addItem(qaNode.id, "test-plan", "Check-In Test Plan", "Integration + E2E tests for check-in flow", "");
      testCase = engine.addItem(qaNode.id, "test-case", "TC: QR scan returns patient info", "Scan valid QR → verify API returns patient data", "");
    });

    it("QA creates test items", () => {
      expect(testPlan.kind).toBe("test-plan");
      expect(testCase.kind).toBe("test-case");
      expect(testPlan.nodeId).toBe(qaNode.id);
    });

    it("QA traces test case from Dev API spec", () => {
      const trace = engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");
      expect(trace.fromNodeId).toBe(qaNode.id);
      expect(trace.toNodeId).toBe(devNode.id);
      expect(trace.relation).toBe("proven_by");
    });

    it("QA audit has no missing upstream refs (vertical hierarchy removed)", () => {
      // Vertical is now a free-form string — no fixed upstream hierarchy.
      // missingUpstreamRefs is always [] regardless of traces.
      const report = engine.audit(qaNode.id);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });

    it("Dev API change propagates to QA test items", () => {
      engine.verifyItem(testCase.id, "Test passes", "diana");
      engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

      // Dev changes API spec
      const signals = engine.propagateChange(apiSpec.id);

      expect(engine.getItem(testCase.id).state).toBe("suspect");
      expect(signals.length).toBeGreaterThanOrEqual(1);
    });

    it("Full cascade: PM → Design → Dev → QA", () => {
      engine.verifyItem(testCase.id, "Test passes", "diana");
      engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

      // Propagate from PRD (PM changes requirements)
      const signals = engine.propagateChange(prd.id);

      // Cascade: PRD → screenSpec(suspect) → apiSpec(suspect) → testCase(suspect)
      expect(engine.getItem(screenSpec.id).state).toBe("suspect");
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");
      expect(engine.getItem(testCase.id).state).toBe("suspect");

      expect(signals.length).toBeGreaterThanOrEqual(3);
    });

    it("QA discovers a bug and marks test case broken", () => {
      engine.verifyItem(testCase.id, "Test passes", "diana");
      engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

      // API change makes test suspect
      engine.propagateChange(apiSpec.id);
      expect(engine.getItem(testCase.id).state).toBe("suspect");

      // QA confirms: this is actually broken
      engine.markBroken(testCase.id, "API response schema changed, test assertions fail", "diana");
      expect(engine.getItem(testCase.id).state).toBe("broke");

      const transitions = store.getItemTransitions(testCase.id);
      const breakT = transitions.find((t) => t.kind === "break");
      expect(breakT).toBeDefined();
      expect(breakT?.actor).toBe("diana");
      expect(breakT?.reason).toBe("API response schema changed, test assertions fail");
    });

    it("QA files a bug report", () => {
      bugReport = engine.addItem(qaNode.id, "bug-report", "BUG: QR scan returns 500 on expired appointment", "Steps to reproduce...", "JIRA-301");
      expect(bugReport.kind).toBe("bug-report");
      expect(bugReport.nodeId).toBe(qaNode.id);
      expect(bugReport.externalRef).toBe("JIRA-301");
    });
  });

  // ── DevOps Scenarios ──────────────────────────────────────────────────

  describe("DevOps: creates runbooks traced from Dev and QA", () => {
    beforeEach(() => {
      // Build the full chain
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
      engine.verifyItem(prd.id, "Approved", "alice");

      apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "", "");
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      engine.addTrace(apiSpec.id, prd.id, "traced_from", "cuong");

      testPlan = engine.addItem(qaNode.id, "test-plan", "Check-In Test Plan", "", "");
      engine.verifyItem(testPlan.id, "QA approved", "diana");
      engine.addTrace(testPlan.id, apiSpec.id, "proven_by", "diana");

      // DevOps creates items
      runbook = engine.addItem(devopsNode.id, "runbook", "Check-In Service Deployment", "Helm chart + health checks + rollback procedure", "");
    });

    it("DevOps creates runbook", () => {
      expect(runbook.kind).toBe("runbook");
      expect(runbook.nodeId).toBe(devopsNode.id);
    });

    it("DevOps traces runbook from Dev API spec and QA test plan", () => {
      const traceFromDev = engine.addTrace(runbook.id, apiSpec.id, "traced_from", "eve");
      const traceFromQA = engine.addTrace(runbook.id, testPlan.id, "matched_by", "eve");

      expect(traceFromDev.fromNodeId).toBe(devopsNode.id);
      expect(traceFromDev.toNodeId).toBe(devNode.id);
      expect(traceFromQA.toNodeId).toBe(qaNode.id);
      expect(traceFromQA.relation).toBe("matched_by");
    });

    it("DevOps audit has no missing upstream refs (vertical hierarchy removed)", () => {
      // Vertical is now a free-form string — no fixed upstream hierarchy.
      // missingUpstreamRefs is always [] regardless of traces.
      const report = engine.audit(devopsNode.id);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });

    it("Dev API change cascades to DevOps runbook", () => {
      engine.verifyItem(runbook.id, "Ops review passed", "eve");
      engine.addTrace(runbook.id, apiSpec.id, "traced_from", "eve");

      const signals = engine.propagateChange(apiSpec.id);

      expect(engine.getItem(runbook.id).state).toBe("suspect");
      expect(signals.length).toBeGreaterThanOrEqual(1);
    });

    it("Full cascade: PM → Dev → QA → DevOps", () => {
      engine.verifyItem(runbook.id, "Ops review passed", "eve");
      engine.addTrace(runbook.id, testPlan.id, "matched_by", "eve");

      // Propagate from API spec (dev changes)
      const signals = engine.propagateChange(apiSpec.id);

      // testPlan (QA) suspect, runbook (DevOps) suspect
      expect(engine.getItem(testPlan.id).state).toBe("suspect");
      expect(engine.getItem(runbook.id).state).toBe("suspect");

      expect(signals.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Cross-Vertical Scenarios ──────────────────────────────────────────

  describe("Cross-vertical: full chain PM → Design → Dev → QA → DevOps", () => {
    beforeEach(() => {
      // PM
      prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
      userStory = engine.addItem(pmNode.id, "user-story", "Patient scans QR code", "", "JIRA-102");
      engine.verifyItem(prd.id, "Approved", "alice");
      engine.verifyItem(userStory.id, "Approved", "alice");
      engine.addTrace(userStory.id, prd.id, "traced_from", "alice");

      // Design
      screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Scanner Screen", "", "FIGMA-201");
      engine.verifyItem(screenSpec.id, "Design reviewed", "bob");
      engine.addTrace(screenSpec.id, userStory.id, "traced_from", "bob");

      // Dev
      apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "", "");
      techDesign = engine.addItem(devNode.id, "tech-design", "QR Verification Service", "", "");
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
      engine.verifyItem(techDesign.id, "Arch review", "cuong");
      engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");
      engine.addTrace(techDesign.id, prd.id, "traced_from", "cuong");

      // QA
      testCase = engine.addItem(qaNode.id, "test-case", "TC: QR scan happy path", "", "");
      engine.verifyItem(testCase.id, "Test passes", "diana");
      engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

      // DevOps
      runbook = engine.addItem(devopsNode.id, "runbook", "Deployment Runbook", "", "");
      engine.verifyItem(runbook.id, "Ops reviewed", "eve");
      engine.addTrace(runbook.id, apiSpec.id, "traced_from", "eve");
    });

    it("PRD change suspects the entire downstream chain", () => {
      const signals = engine.propagateChange(prd.id);

      // Direct dependents of PRD: userStory, techDesign
      expect(engine.getItem(userStory.id).state).toBe("suspect");
      expect(engine.getItem(techDesign.id).state).toBe("suspect");

      // Cascade through userStory → screenSpec
      expect(engine.getItem(screenSpec.id).state).toBe("suspect");

      // Cascade through screenSpec → apiSpec
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");

      // Cascade through apiSpec → testCase, runbook
      expect(engine.getItem(testCase.id).state).toBe("suspect");
      expect(engine.getItem(runbook.id).state).toBe("suspect");

      // PRD itself stays proven (it's the source of change)
      expect(engine.getItem(prd.id).state).toBe("proven");

      // 6 items should be suspect
      expect(signals).toHaveLength(6);
    });

    it("impact analysis shows all downstream items without changing state", () => {
      const impacted = engine.impact(prd.id);

      // All 6 downstream items should be in impact list
      expect(impacted).toHaveLength(6);
      const impactedIds = impacted.map((i) => i.id).sort();
      expect(impactedIds).toEqual(
        [userStory.id, screenSpec.id, apiSpec.id, techDesign.id, testCase.id, runbook.id].sort(),
      );

      // State should NOT change
      expect(engine.getItem(userStory.id).state).toBe("proven");
      expect(engine.getItem(screenSpec.id).state).toBe("proven");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");
      expect(engine.getItem(testCase.id).state).toBe("proven");
      expect(engine.getItem(runbook.id).state).toBe("proven");
    });

    it("sweep by external ref triggers cascade", () => {
      const result = engine.sweep("JIRA-101");

      expect(result.triggerRef).toBe("JIRA-101");
      expect(result.matchedItems).toHaveLength(1);
      expect(result.matchedItems[0].id).toBe(prd.id);

      // All downstream items affected
      expect(result.affectedItems.length).toBeGreaterThanOrEqual(6);
      expect(result.signalsCreated).toBeGreaterThanOrEqual(6);
    });

    it("each vertical sees correct audit state after PRD change", () => {
      engine.propagateChange(prd.id);

      // PM: 2 items, 1 proven (PRD) + 1 suspect (userStory)
      const pmReport = engine.audit(pmNode.id);
      expect(pmReport.totalItems).toBe(2);
      expect(pmReport.proven).toHaveLength(1);
      expect(pmReport.suspect).toHaveLength(1);

      // Design: 1 item, suspect
      const designReport = engine.audit(designNode.id);
      expect(designReport.totalItems).toBe(1);
      expect(designReport.suspect).toHaveLength(1);

      // Dev: 2 items, both suspect
      const devReport = engine.audit(devNode.id);
      expect(devReport.totalItems).toBe(2);
      expect(devReport.suspect).toHaveLength(2);

      // QA: 1 item, suspect
      const qaReport = engine.audit(qaNode.id);
      expect(qaReport.totalItems).toBe(1);
      expect(qaReport.suspect).toHaveLength(1);

      // DevOps: 1 item, suspect
      const devopsReport = engine.audit(devopsNode.id);
      expect(devopsReport.totalItems).toBe(1);
      expect(devopsReport.suspect).toHaveLength(1);
    });

    it("verticals re-verify in order after PRD change", () => {
      engine.propagateChange(prd.id);

      // PM re-verifies user story
      engine.verifyItem(userStory.id, "Requirements still valid after PRD update", "alice");
      expect(engine.getItem(userStory.id).state).toBe("proven");
      // This propagates change again to screenSpec (already suspect, stays suspect)

      // Design re-verifies
      engine.verifyItem(screenSpec.id, "Screen spec updated to match new requirements", "bob");
      expect(engine.getItem(screenSpec.id).state).toBe("proven");

      // Dev re-verifies
      engine.verifyItem(apiSpec.id, "API compatible with new requirements", "cuong");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");

      engine.verifyItem(techDesign.id, "Tech design still valid", "cuong");
      expect(engine.getItem(techDesign.id).state).toBe("proven");

      // QA re-verifies
      engine.verifyItem(testCase.id, "Test updated and passes", "diana");
      expect(engine.getItem(testCase.id).state).toBe("proven");

      // DevOps re-verifies
      engine.verifyItem(runbook.id, "Deployment procedure unchanged", "eve");
      expect(engine.getItem(runbook.id).state).toBe("proven");

      // All items proven again
      const allItems = [
        ...engine.listItems(pmNode.id),
        ...engine.listItems(designNode.id),
        ...engine.listItems(devNode.id),
        ...engine.listItems(qaNode.id),
        ...engine.listItems(devopsNode.id),
      ];
      expect(allItems.every((i) => i.state === "proven")).toBe(true);
    });

    it("QA marks test broken, Dev fixes, QA re-verifies", () => {
      engine.propagateChange(prd.id);

      // QA confirms test is broken
      engine.markBroken(testCase.id, "API schema change broke assertion", "diana");
      expect(engine.getItem(testCase.id).state).toBe("broke");

      // Dev fixes the API and re-verifies
      engine.verifyItem(apiSpec.id, "Fixed API to match new schema", "cuong");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");
      // Propagation from re-verify doesn't affect already-broken testCase

      // QA updates test and fixes it
      engine.verifyItem(testCase.id, "Test assertions updated, all passing", "diana");
      expect(engine.getItem(testCase.id).state).toBe("proven");

      const transitions = store.getItemTransitions(testCase.id);
      const kinds = transitions.map((t) => t.kind);
      expect(kinds).toContain("verify");   // initial
      expect(kinds).toContain("suspect");  // from propagation
      expect(kinds).toContain("break");    // QA confirmed broken
      expect(kinds).toContain("fix");      // QA re-verified (broke → proven)
    });
  });

  // ── Query Scenarios ───────────────────────────────────────────────────

  describe("Cross-vertical: queries between roles", () => {
    beforeEach(() => {
      pmNode = engine.registerNode("pm-node-q", "pm", PROJECT, "alice", false);
      devNode = engine.registerNode("dev-node-q", "dev", PROJECT, "cuong", false);
      qaNode = engine.registerNode("qa-node-q", "qa", PROJECT, "diana", false);
    });

    it("Dev asks PM a clarification question", () => {
      const query = engine.ask("cuong", devNode.id, "What is the expected QR format?", "Need for API validation", pmNode.id);

      expect(query.askerId).toBe("cuong");
      expect(query.askerNode).toBe(devNode.id);
      expect(query.question).toBe("What is the expected QR format?");
      expect(query.targetNode).toBe(pmNode.id);
      expect(query.resolved).toBe(false);
    });

    it("PM responds to Dev query", () => {
      const query = engine.ask("cuong", devNode.id, "What is the expected QR format?", "", pmNode.id);
      const response = engine.respond(query.id, "alice", pmNode.id, "QR contains appointment UUID in base64", false);

      expect(response.queryId).toBe(query.id);
      expect(response.responderId).toBe("alice");
      expect(response.answer).toBe("QR contains appointment UUID in base64");
      expect(response.isAI).toBe(false);
    });

    it("QA asks Dev about API behavior", () => {
      const query = engine.ask("diana", qaNode.id, "What HTTP status code for expired appointment?", "", devNode.id);
      const response = engine.respond(query.id, "cuong", devNode.id, "410 Gone", false);

      expect(query.targetNode).toBe(devNode.id);
      expect(response.answer).toBe("410 Gone");
    });

    it("AI agent responds to a query", () => {
      const aiNode = engine.registerNode("ai-assistant", "dev", PROJECT, "claude", true);
      const query = engine.ask("cuong", devNode.id, "Summarize the check-in flow", "", aiNode.id);
      const response = engine.respond(query.id, "claude", aiNode.id, "Patient scans QR → API validates → Confirm → Done", true);

      expect(response.isAI).toBe(true);
    });
  });

  // ── Event Bus Scenarios ───────────────────────────────────────────────

  describe("Cross-vertical: event bus notifications", () => {
    it("EventBus emits events for each signal during cascade", () => {
      const events: Array<{ type: string; data: unknown }> = [];
      const wsHandlers = new WSHandlers(engine, store, eventBus);

      eventBus.on("signal_change", (data) => {
        events.push({ type: "signal_change", data });
      });

      // Setup chain
      prd = engine.addItem(pmNode.id, "prd", "PRD", "", "");
      apiSpec = engine.addItem(devNode.id, "api-spec", "API", "", "");
      engine.verifyItem(prd.id, "ok", "alice");
      engine.verifyItem(apiSpec.id, "ok", "cuong");
      engine.addTrace(apiSpec.id, prd.id, "traced_from", "cuong");

      // Simulate incoming network message
      wsHandlers.handle({
        messageId: "m1",
        fromNode: "remote",
        toNode: pmNode.id,
        projectId: PROJECT,
        timestamp: new Date().toISOString(),
        payload: {
          type: "signal_change",
          itemId: prd.id,
          oldState: "proven",
          newState: "suspect",
        },
      });

      // Event bus should have received the signal_change event
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("signal_change");
    });

    it("EventBus emits query_ask when remote node asks", () => {
      const events: unknown[] = [];
      const wsHandlers = new WSHandlers(engine, store, eventBus);

      eventBus.on("query_ask", (data) => {
        events.push(data);
      });

      wsHandlers.handle({
        messageId: "m2",
        fromNode: qaNode.id,
        toNode: devNode.id,
        projectId: PROJECT,
        timestamp: new Date().toISOString(),
        payload: {
          type: "query_ask",
          question: "What error codes does the API return?",
          askerId: qaNode.id,
        },
      });

      expect(events).toHaveLength(1);
    });
  });

  // ── Node Listing Scenarios ────────────────────────────────────────────

  describe("Node management across verticals", () => {
    it("lists all 5 nodes for the project", () => {
      const nodes = engine.listNodes(PROJECT);
      expect(nodes).toHaveLength(5);

      const verticals = nodes.map((n) => n.vertical).sort();
      expect(verticals).toEqual(["design", "dev", "devops", "pm", "qa"]);
    });

    it("each node has correct owner", () => {
      const nodes = engine.listNodes(PROJECT);
      const owners = new Map(nodes.map((n) => [n.vertical, n.owner]));

      expect(owners.get("pm")).toBe("alice");
      expect(owners.get("design")).toBe("bob");
      expect(owners.get("dev")).toBe("cuong");
      expect(owners.get("qa")).toBe("diana");
      expect(owners.get("devops")).toBe("eve");
    });

    it("nodes from different projects are isolated", () => {
      engine.registerNode("other-pm", "pm", "other-project", "frank", false);

      const clinicNodes = engine.listNodes(PROJECT);
      const otherNodes = engine.listNodes("other-project");

      expect(clinicNodes).toHaveLength(5);
      expect(otherNodes).toHaveLength(1);
    });
  });
});
