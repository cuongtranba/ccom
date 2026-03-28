import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import type { Item } from "@inv/shared";

describe("Engine", () => {
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

  // ── registerNode ──────────────────────────────────────────────────────

  describe("registerNode", () => {
    it("creates a node with correct fields", () => {
      const node = engine.registerNode("api-node", "dev", "proj-a", "alice", false);

      expect(node.name).toBe("api-node");
      expect(node.vertical).toBe("dev");
      expect(node.project).toBe("proj-a");
      expect(node.owner).toBe("alice");
      expect(node.isAI).toBe(false);
      expect(node.id).toBeDefined();
      expect(node.createdAt).toBeDefined();
    });

    it("creates AI nodes", () => {
      const node = engine.registerNode("ai-node", "qa", "proj-a", "bot", true);
      expect(node.isAI).toBe(true);
    });
  });

  // ── getNode ───────────────────────────────────────────────────────────

  describe("getNode", () => {
    it("returns a node by id", () => {
      const created = engine.registerNode("n", "dev", "p", "o", false);
      const found = engine.getNode(created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws for nonexistent node", () => {
      expect(() => engine.getNode("no-such-id")).toThrow("Node not found");
    });
  });

  // ── listNodes ─────────────────────────────────────────────────────────

  describe("listNodes", () => {
    it("lists nodes by project", () => {
      engine.registerNode("a", "dev", "proj-1", "o", false);
      engine.registerNode("b", "qa", "proj-1", "o", false);
      engine.registerNode("c", "pm", "proj-2", "o", false);

      const nodes = engine.listNodes("proj-1");
      expect(nodes).toHaveLength(2);
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────

  describe("addItem", () => {
    it("creates an item in unverified state", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "Title", "Body", "EXT-1");

      expect(item.title).toBe("Title");
      expect(item.body).toBe("Body");
      expect(item.externalRef).toBe("EXT-1");
      expect(item.kind).toBe("decision");
      expect(item.state).toBe("unverified");
      expect(item.nodeId).toBe(node.id);
    });

    it("throws for nonexistent node", () => {
      expect(() => engine.addItem("bad-id", "decision", "T", "", "")).toThrow(
        "Node not found",
      );
    });

    it("creates item with optional fields defaulted", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "adr", "Minimal");

      expect(item.body).toBe("");
      expect(item.externalRef).toBe("");
    });
  });

  // ── getItem ───────────────────────────────────────────────────────────

  describe("getItem", () => {
    it("returns item by id", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const created = engine.addItem(node.id, "decision", "T", "", "");
      const found = engine.getItem(created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws for nonexistent item", () => {
      expect(() => engine.getItem("no-such-id")).toThrow("Item not found");
    });
  });

  // ── listItems ─────────────────────────────────────────────────────────

  describe("listItems", () => {
    it("lists items for a node", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      engine.addItem(node.id, "decision", "A", "", "");
      engine.addItem(node.id, "adr", "B", "", "");

      const items = engine.listItems(node.id);
      expect(items).toHaveLength(2);
    });
  });

  // ── addTrace ──────────────────────────────────────────────────────────

  describe("addTrace", () => {
    it("creates a trace between two items", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const itemA = engine.addItem(node.id, "decision", "A", "", "");
      const itemB = engine.addItem(node.id, "adr", "B", "", "");

      const trace = engine.addTrace(itemA.id, itemB.id, "traced_from", "alice");

      expect(trace.fromItemId).toBe(itemA.id);
      expect(trace.toItemId).toBe(itemB.id);
      expect(trace.fromNodeId).toBe(node.id);
      expect(trace.toNodeId).toBe(node.id);
      expect(trace.relation).toBe("traced_from");
    });

    it("throws for nonexistent from-item", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const itemB = engine.addItem(node.id, "adr", "B", "", "");

      expect(() => engine.addTrace("bad-id", itemB.id, "traced_from", "alice")).toThrow(
        "Item not found",
      );
    });

    it("throws for nonexistent to-item", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const itemA = engine.addItem(node.id, "decision", "A", "", "");

      expect(() => engine.addTrace(itemA.id, "bad-id", "traced_from", "alice")).toThrow(
        "Item not found",
      );
    });
  });

  // ── verifyItem ────────────────────────────────────────────────────────

  describe("verifyItem", () => {
    it("transitions unverified to proven (verify)", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      const signals = engine.verifyItem(item.id, "proof-data", "alice");

      const updated = engine.getItem(item.id);
      expect(updated.state).toBe("proven");
      expect(updated.evidence).toBe("proof-data");
      expect(updated.confirmedBy).toBe("alice");
      expect(signals).toBeArray();
    });

    it("records a transition for verify", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      engine.verifyItem(item.id, "proof", "alice");

      const transitions = store.getItemTransitions(item.id);
      expect(transitions).toHaveLength(1);
      expect(transitions[0].kind).toBe("verify");
      expect(transitions[0].from).toBe("unverified");
      expect(transitions[0].to).toBe("proven");
      expect(transitions[0].actor).toBe("alice");
    });

    it("transitions suspect to proven (re_verify)", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      // Move to proven, then to suspect
      engine.verifyItem(item.id, "proof", "alice");
      store.updateItemStatus(item.id, "suspect", "upstream-change", "propagator");
      store.recordTransition({
        itemId: item.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "propagator",
      });

      const signals = engine.verifyItem(item.id, "re-proof", "bob");

      const updated = engine.getItem(item.id);
      expect(updated.state).toBe("proven");

      const transitions = store.getItemTransitions(item.id);
      const reVerify = transitions.find((t) => t.kind === "re_verify");
      expect(reVerify).toBeDefined();
      expect(reVerify?.from).toBe("suspect");
      expect(reVerify?.to).toBe("proven");
    });

    it("transitions broke to proven (fix)", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      // Move: unverified -> proven -> suspect -> broke
      engine.verifyItem(item.id, "proof", "alice");
      store.updateItemStatus(item.id, "suspect", "upstream-change", "propagator");
      store.recordTransition({
        itemId: item.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "propagator",
      });
      store.updateItemStatus(item.id, "broke", "confirmed-broken", "tester");
      store.recordTransition({
        itemId: item.id,
        kind: "break",
        from: "suspect",
        to: "broke",
        actor: "tester",
      });

      const signals = engine.verifyItem(item.id, "fixed-it", "carol");

      const updated = engine.getItem(item.id);
      expect(updated.state).toBe("proven");

      const transitions = store.getItemTransitions(item.id);
      const fix = transitions.find((t) => t.kind === "fix");
      expect(fix).toBeDefined();
      expect(fix?.from).toBe("broke");
      expect(fix?.to).toBe("proven");
    });

    it("throws for already proven item", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      engine.verifyItem(item.id, "proof", "alice");

      expect(() => engine.verifyItem(item.id, "again", "bob")).toThrow();
    });

    it("propagates changes to downstream items", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const upstream = engine.addItem(node.id, "decision", "Upstream", "", "");
      const downstream = engine.addItem(node.id, "adr", "Downstream", "", "");

      // Verify both
      engine.verifyItem(upstream.id, "proof-u", "alice");
      engine.verifyItem(downstream.id, "proof-d", "alice");

      // Trace: downstream depends on upstream
      store.createTrace({
        fromItemId: downstream.id,
        fromNodeId: node.id,
        toItemId: upstream.id,
        toNodeId: node.id,
        relation: "traced_from",
      });

      // Move upstream to suspect then re-verify -- this should propagate
      store.updateItemStatus(upstream.id, "suspect", "changed", "system");
      store.recordTransition({
        itemId: upstream.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "system",
      });

      const signals = engine.verifyItem(upstream.id, "re-proof", "alice");

      // Downstream should now be suspect from propagation
      const updatedDown = engine.getItem(downstream.id);
      expect(updatedDown.state).toBe("suspect");
      expect(signals.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── markBroken ────────────────────────────────────────────────────────

  describe("markBroken", () => {
    it("transitions suspect to broke", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      // Move to suspect via: unverified -> proven -> suspect
      engine.verifyItem(item.id, "proof", "alice");
      store.updateItemStatus(item.id, "suspect", "upstream-change", "propagator");
      store.recordTransition({
        itemId: item.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "propagator",
      });

      engine.markBroken(item.id, "confirmed broken", "bob");

      const updated = engine.getItem(item.id);
      expect(updated.state).toBe("broke");

      const transitions = store.getItemTransitions(item.id);
      const breakT = transitions.find((t) => t.kind === "break");
      expect(breakT).toBeDefined();
      expect(breakT?.reason).toBe("confirmed broken");
    });

    it("throws for non-suspect state (unverified)", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");

      expect(() => engine.markBroken(item.id, "reason", "bob")).toThrow(
        "suspect",
      );
    });

    it("throws for non-suspect state (proven)", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "");
      engine.verifyItem(item.id, "proof", "alice");

      expect(() => engine.markBroken(item.id, "reason", "bob")).toThrow(
        "suspect",
      );
    });
  });

  // ── impact ────────────────────────────────────────────────────────────

  describe("impact", () => {
    it("returns downstream items", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const upstream = engine.addItem(node.id, "decision", "Upstream", "", "");
      const downstream = engine.addItem(node.id, "adr", "Downstream", "", "");

      store.createTrace({
        fromItemId: downstream.id,
        fromNodeId: node.id,
        toItemId: upstream.id,
        toNodeId: node.id,
        relation: "traced_from",
      });

      const impacted = engine.impact(upstream.id);
      expect(impacted).toHaveLength(1);
      expect(impacted[0].id).toBe(downstream.id);
    });

    it("returns empty for items with no dependents", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "Solo", "", "");

      const impacted = engine.impact(item.id);
      expect(impacted).toHaveLength(0);
    });
  });

  // ── audit ─────────────────────────────────────────────────────────────

  describe("audit", () => {
    it("returns correct report", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item1 = engine.addItem(node.id, "decision", "A", "", "");
      const item2 = engine.addItem(node.id, "adr", "B", "", "");

      engine.verifyItem(item1.id, "proof", "alice");

      const report = engine.audit(node.id);

      expect(report.nodeId).toBe(node.id);
      expect(report.totalItems).toBe(2);
      expect(report.proven).toContain(item1.id);
      expect(report.unverified).toContain(item2.id);
      expect(report.orphans).toHaveLength(2); // no traces on either item
    });
  });

  // ── ask ───────────────────────────────────────────────────────────────

  describe("ask", () => {
    it("creates a query", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);

      const query = engine.ask("user-1", node.id, "How does X work?", "context-info", "target-node");

      expect(query.askerId).toBe("user-1");
      expect(query.askerNode).toBe(node.id);
      expect(query.question).toBe("How does X work?");
      expect(query.context).toBe("context-info");
      expect(query.targetNode).toBe("target-node");
      expect(query.resolved).toBe(false);
    });

    it("creates a query with optional fields defaulted", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);

      const query = engine.ask("user-1", node.id, "Why?");

      expect(query.context).toBe("");
      expect(query.targetNode).toBe("");
    });
  });

  // ── respond ───────────────────────────────────────────────────────────

  describe("respond", () => {
    it("creates a response", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const query = engine.ask("user-1", node.id, "How?");

      const response = engine.respond(query.id, "responder-1", node.id, "Like this.", false);

      expect(response.queryId).toBe(query.id);
      expect(response.responderId).toBe("responder-1");
      expect(response.nodeId).toBe(node.id);
      expect(response.answer).toBe("Like this.");
      expect(response.isAI).toBe(false);
    });

    it("creates an AI response", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const query = engine.ask("user-1", node.id, "How?");

      const response = engine.respond(query.id, "bot-1", node.id, "AI answer.", true);

      expect(response.isAI).toBe(true);
    });
  });

  // ── propagateChange ───────────────────────────────────────────────────

  describe("propagateChange", () => {
    it("delegates to propagator", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const upstream = engine.addItem(node.id, "decision", "Up", "", "");
      const downstream = engine.addItem(node.id, "adr", "Down", "", "");

      // Prove downstream
      engine.verifyItem(downstream.id, "proof", "alice");

      // Trace: downstream depends on upstream
      store.createTrace({
        fromItemId: downstream.id,
        fromNodeId: node.id,
        toItemId: upstream.id,
        toNodeId: node.id,
        relation: "traced_from",
      });

      const signals = engine.propagateChange(upstream.id);

      expect(signals).toHaveLength(1);
      expect(signals[0].targetItem).toBe(downstream.id);
      expect(engine.getItem(downstream.id).state).toBe("suspect");
    });
  });

  // ── sweep ─────────────────────────────────────────────────────────────

  describe("sweep", () => {
    it("finds items by external ref and propagates", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      const item = engine.addItem(node.id, "decision", "T", "", "EXT-123");
      const downstream = engine.addItem(node.id, "adr", "Down", "", "");

      // Prove both items
      engine.verifyItem(item.id, "proof", "alice");
      engine.verifyItem(downstream.id, "proof-d", "alice");

      // Trace: downstream depends on item
      store.createTrace({
        fromItemId: downstream.id,
        fromNodeId: node.id,
        toItemId: item.id,
        toNodeId: node.id,
        relation: "traced_from",
      });

      const result = engine.sweep("EXT-123");

      expect(result.triggerRef).toBe("EXT-123");
      expect(result.matchedItems).toHaveLength(1);
      expect(result.matchedItems[0].id).toBe(item.id);
      expect(result.affectedItems.length).toBeGreaterThanOrEqual(1);
      expect(result.signalsCreated).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results for unknown ref", () => {
      const result = engine.sweep("NONEXISTENT");

      expect(result.triggerRef).toBe("NONEXISTENT");
      expect(result.matchedItems).toHaveLength(0);
      expect(result.affectedItems).toHaveLength(0);
      expect(result.signalsCreated).toBe(0);
    });

    it("handles multiple matched items", () => {
      const node = engine.registerNode("n", "dev", "p", "o", false);
      engine.addItem(node.id, "decision", "A", "", "SHARED-REF");
      engine.addItem(node.id, "adr", "B", "", "SHARED-REF");

      const result = engine.sweep("SHARED-REF");

      expect(result.matchedItems).toHaveLength(2);
    });
  });

  // ── Proposals & Voting ────────────────────────────────────────────────

  describe("Proposals and Voting", () => {
    let pmNode: ReturnType<typeof engine.registerNode>;
    let designNode: ReturnType<typeof engine.registerNode>;
    let devNode: ReturnType<typeof engine.registerNode>;
    let qaNode: ReturnType<typeof engine.registerNode>;
    let devopsNode: ReturnType<typeof engine.registerNode>;
    let prd: Item;
    let screenSpec: Item;

    beforeEach(() => {
      pmNode = engine.registerNode("pm-node", "pm", "proj", "alice", false);
      designNode = engine.registerNode("design-node", "design", "proj", "bob", false);
      devNode = engine.registerNode("dev-node", "dev", "proj", "cuong", false);
      qaNode = engine.registerNode("qa-node", "qa", "proj", "diana", false);
      devopsNode = engine.registerNode("devops-node", "devops", "proj", "eve", false);

      prd = engine.addItem(pmNode.id, "prd", "Clinic PRD");
      engine.verifyItem(prd.id, "Approved", "alice");

      screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Screen");
      engine.verifyItem(screenSpec.id, "Reviewed", "bob");
      engine.addTrace(screenSpec.id, prd.id, "traced_from", "bob");
    });

    it("creates a proposal in draft status", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Update PRD");
      expect(cr.status).toBe("draft");
      expect(cr.targetItemId).toBe(prd.id);
    });

    it("submits a draft proposal to proposed", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      const submitted = engine.submitProposal(cr.id);
      expect(submitted.status).toBe("proposed");
    });

    it("opens voting on a proposed CR", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      engine.submitProposal(cr.id);
      const voting = engine.openVoting(cr.id);
      expect(voting.status).toBe("voting");
    });

    it("casts a vote on a voting CR", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      const vote = engine.castVote(cr.id, devNode.id, "dev", true, "LGTM");
      expect(vote.approve).toBe(true);
    });

    it("throws when voting on non-voting CR", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      expect(() => engine.castVote(cr.id, devNode.id, "dev", true, "No")).toThrow();
    });

    it("resolves approved by majority", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, designNode.id, "design", true, "Yes");
      engine.castVote(cr.id, devNode.id, "dev", true, "Yes");
      engine.castVote(cr.id, qaNode.id, "qa", false, "No");

      const resolved = engine.resolveVoting(cr.id);
      expect(resolved.status).toBe("approved");
    });

    it("resolves rejected by majority", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Test");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, designNode.id, "design", false, "No");
      engine.castVote(cr.id, devNode.id, "dev", false, "No");
      engine.castVote(cr.id, qaNode.id, "qa", true, "Yes");

      const resolved = engine.resolveVoting(cr.id);
      expect(resolved.status).toBe("rejected");
    });

    it("tie-breaking: rejects on tie (vertical hierarchy removed)", () => {
      // Without UPSTREAM_VERTICALS, ties default to rejected.
      const cr = engine.createProposal(designNode.id, "bob", screenSpec.id, "Redesign");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, pmNode.id, "pm", true, "Good idea");
      engine.castVote(cr.id, devNode.id, "dev", false, "Too much work");
      engine.castVote(cr.id, qaNode.id, "qa", false, "Risk");
      engine.castVote(cr.id, devopsNode.id, "devops", true, "No impact");

      const resolved = engine.resolveVoting(cr.id);
      expect(resolved.status).toBe("rejected");
    });

    it("applies approved proposal and propagates changes", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Change");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, devNode.id, "dev", true, "OK");
      engine.resolveVoting(cr.id);

      const result = engine.applyProposal(cr.id);
      expect(result.cr.status).toBe("applied");
      expect(result.signals.length).toBeGreaterThanOrEqual(1);
      expect(engine.getItem(screenSpec.id).state).toBe("suspect");
    });

    it("archives an applied proposal", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Change");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, devNode.id, "dev", true, "OK");
      engine.resolveVoting(cr.id);
      engine.applyProposal(cr.id);

      const archived = engine.archiveProposal(cr.id);
      expect(archived.status).toBe("archived");
    });

    it("cannot apply a rejected proposal", () => {
      const cr = engine.createProposal(pmNode.id, "alice", prd.id, "Bad idea");
      engine.submitProposal(cr.id);
      engine.openVoting(cr.id);
      engine.castVote(cr.id, devNode.id, "dev", false, "No");
      engine.resolveVoting(cr.id);

      expect(() => engine.applyProposal(cr.id)).toThrow();
    });
  });

  // ── Challenges ────────────────────────────────────────────────────────

  describe("Challenges", () => {
    let pmNode: ReturnType<typeof engine.registerNode>;
    let devNode: ReturnType<typeof engine.registerNode>;
    let qaNode: ReturnType<typeof engine.registerNode>;
    let devopsNode: ReturnType<typeof engine.registerNode>;
    let apiSpec: Item;
    let testCase: Item;

    beforeEach(() => {
      pmNode = engine.registerNode("pm-node", "pm", "proj", "alice", false);
      devNode = engine.registerNode("dev-node", "dev", "proj", "cuong", false);
      qaNode = engine.registerNode("qa-node", "qa", "proj", "diana", false);
      devopsNode = engine.registerNode("devops-node", "devops", "proj", "eve", false);

      apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API");
      engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");

      testCase = engine.addItem(qaNode.id, "test-case", "TC: QR scan");
      engine.verifyItem(testCase.id, "Test passes", "diana");
      engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");
    });

    it("creates a challenge as a CR targeting the item", () => {
      const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Bug found");
      expect(challenge.status).toBe("draft");
      expect(challenge.targetItemId).toBe(apiSpec.id);
      expect(challenge.description).toContain("Bug found");
    });

    it("upheld challenge marks item suspect and propagates", () => {
      const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Missing validation");
      engine.submitProposal(challenge.id);
      engine.openVoting(challenge.id);
      engine.castVote(challenge.id, pmNode.id, "pm", true, "Confirmed");
      engine.castVote(challenge.id, devopsNode.id, "devops", true, "Agreed");
      engine.resolveVoting(challenge.id);

      const result = engine.upholdChallenge(challenge.id);
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");
      expect(result.signals.length).toBeGreaterThanOrEqual(1);
      expect(engine.getItem(testCase.id).state).toBe("suspect");
    });

    it("dismissed challenge leaves items unchanged", () => {
      const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Timeout concern");
      engine.submitProposal(challenge.id);
      engine.openVoting(challenge.id);
      engine.castVote(challenge.id, pmNode.id, "pm", false, "Fine");
      engine.castVote(challenge.id, devNode.id, "dev", false, "By design");
      engine.resolveVoting(challenge.id);

      engine.dismissChallenge(challenge.id);
      expect(engine.getItem(apiSpec.id).state).toBe("proven");
      expect(engine.getItem(testCase.id).state).toBe("proven");
    });

    it("cannot uphold a rejected challenge", () => {
      const challenge = engine.createChallenge(qaNode.id, "diana", apiSpec.id, "Concern");
      engine.submitProposal(challenge.id);
      engine.openVoting(challenge.id);
      engine.castVote(challenge.id, devNode.id, "dev", false, "No");
      engine.resolveVoting(challenge.id);

      expect(() => engine.upholdChallenge(challenge.id)).toThrow();
    });
  });

  // ── Pairing Sessions ──────────────────────────────────────────────────

  describe("Pairing Sessions", () => {
    const PROJECT = "proj";
    let pmNode: ReturnType<typeof engine.registerNode>;
    let devNode: ReturnType<typeof engine.registerNode>;

    beforeEach(() => {
      pmNode = engine.registerNode("pm-node", "pm", PROJECT, "alice", false);
      devNode = engine.registerNode("dev-node", "dev", PROJECT, "cuong", false);
    });

    it("initiates a pair session", () => {
      const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
      expect(session.status).toBe("pending");
      expect(session.initiatorNode).toBe(pmNode.id);
      expect(session.partnerNode).toBe(devNode.id);
    });

    it("joins a pending pair session", () => {
      const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
      const active = engine.joinPair(session.id);
      expect(active.status).toBe("active");
    });

    it("ends an active pair session", () => {
      const session = engine.invitePair(pmNode.id, devNode.id, PROJECT);
      engine.joinPair(session.id);
      const ended = engine.endPair(session.id);
      expect(ended.status).toBe("ended");
    });

    it("lists active sessions for a node", () => {
      engine.invitePair(pmNode.id, devNode.id, PROJECT);
      const sessions = engine.listPairSessions(pmNode.id);
      expect(sessions).toHaveLength(1);
    });
  });

  // ── Checklists ────────────────────────────────────────────────────────

  describe("Checklists", () => {
    let prd: Item;

    beforeEach(() => {
      const node = engine.registerNode("pm-node", "pm", "proj", "alice", false);
      prd = engine.addItem(node.id, "prd", "Clinic PRD");
    });

    it("adds a checklist item to an inventory item", () => {
      const cl = engine.addChecklistItem(prd.id, "Verify scope");
      expect(cl.text).toBe("Verify scope");
      expect(cl.checked).toBe(false);
    });

    it("checks and unchecks a checklist item", () => {
      const cl = engine.addChecklistItem(prd.id, "Review API");
      engine.checkChecklistItem(cl.id);
      expect(engine.listChecklist(prd.id)[0].checked).toBe(true);
      engine.uncheckChecklistItem(cl.id);
      expect(engine.listChecklist(prd.id)[0].checked).toBe(false);
    });

    it("lists checklist for an item", () => {
      engine.addChecklistItem(prd.id, "A");
      engine.addChecklistItem(prd.id, "B");
      expect(engine.listChecklist(prd.id)).toHaveLength(2);
    });
  });

  // ── Kind Mappings ─────────────────────────────────────────────────────

  describe("Kind Mappings", () => {
    it("creates and retrieves a kind mapping", () => {
      engine.addKindMapping("pm", "prd", "dev", "tech-design");
      const mapped = engine.getMappedKind("pm", "prd", "dev");
      expect(mapped).toBe("tech-design");
    });

    it("returns null for unmapped kind", () => {
      expect(engine.getMappedKind("pm", "prd", "qa")).toBeNull();
    });
  });
});
