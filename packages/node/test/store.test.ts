import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import type {
  Node,
  Item,
  Trace,
  Signal,
  Transition,
  Query,
  QueryResponse,
  PendingAction,
  AuditReport,
  ChangeRequest,
  Vote,
  VoteTally,
} from "@inv/shared";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // ── Nodes ──────────────────────────────────────────────────────────────

  describe("nodes", () => {
    it("createNode + getNode round-trip", () => {
      const node = store.createNode({
        name: "PM Node",
        vertical: "pm",
        project: "proj-1",
        owner: "alice",
        isAI: false,
      });

      expect(node.id).toBeDefined();
      expect(node.name).toBe("PM Node");
      expect(node.vertical).toBe("pm");
      expect(node.project).toBe("proj-1");
      expect(node.owner).toBe("alice");
      expect(node.isAI).toBe(false);
      expect(node.createdAt).toBeDefined();

      const fetched = store.getNode(node.id);
      expect(fetched).toEqual(node);
    });

    it("listNodes filters by project", () => {
      store.createNode({ name: "N1", vertical: "pm", project: "proj-1", owner: "a", isAI: false });
      store.createNode({ name: "N2", vertical: "dev", project: "proj-1", owner: "b", isAI: false });
      store.createNode({ name: "N3", vertical: "qa", project: "proj-2", owner: "c", isAI: false });

      const proj1Nodes = store.listNodes("proj-1");
      expect(proj1Nodes).toHaveLength(2);
      expect(proj1Nodes.map((n) => n.name).sort()).toEqual(["N1", "N2"]);

      const proj2Nodes = store.listNodes("proj-2");
      expect(proj2Nodes).toHaveLength(1);
      expect(proj2Nodes[0].name).toBe("N3");
    });

    it("getNode returns null for missing", () => {
      const result = store.getNode("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  // ── Items ──────────────────────────────────────────────────────────────

  describe("items", () => {
    let nodeId: string;

    beforeEach(() => {
      const node = store.createNode({
        name: "Dev Node",
        vertical: "dev",
        project: "proj-1",
        owner: "bob",
        isAI: false,
      });
      nodeId = node.id;
    });

    it("createItem + getItem round-trip", () => {
      const item = store.createItem({
        nodeId,
        kind: "adr",
        title: "Use SQLite for storage",
        body: "We decided to use SQLite",
        externalRef: "ADR-001",
      });

      expect(item.id).toBeDefined();
      expect(item.nodeId).toBe(nodeId);
      expect(item.kind).toBe("adr");
      expect(item.title).toBe("Use SQLite for storage");
      expect(item.body).toBe("We decided to use SQLite");
      expect(item.externalRef).toBe("ADR-001");
      expect(item.state).toBe("unverified");
      expect(item.version).toBe(1);

      const fetched = store.getItem(item.id);
      expect(fetched).toEqual(item);
    });

    it("listItems returns items for a node", () => {
      store.createItem({ nodeId, kind: "adr", title: "ADR 1" });
      store.createItem({ nodeId, kind: "tech-design", title: "TD 1" });

      const items = store.listItems(nodeId);
      expect(items).toHaveLength(2);
    });

    it("updateItemStatus changes state and bumps version", () => {
      const item = store.createItem({ nodeId, kind: "adr", title: "Test item" });
      expect(item.state).toBe("unverified");
      expect(item.version).toBe(1);

      const updated = store.updateItemStatus(item.id, "proven", "evidence.md", "alice");
      expect(updated.state).toBe("proven");
      expect(updated.evidence).toBe("evidence.md");
      expect(updated.confirmedBy).toBe("alice");
      expect(updated.confirmedAt).toBeDefined();
      expect(updated.version).toBe(2);
    });

    it("findItemsByExternalRef returns matching items", () => {
      store.createItem({ nodeId, kind: "adr", title: "ADR 1", externalRef: "EXT-100" });
      store.createItem({ nodeId, kind: "tech-design", title: "TD 1", externalRef: "EXT-200" });
      store.createItem({ nodeId, kind: "prd", title: "PRD 1", externalRef: "EXT-100" });

      const matches = store.findItemsByExternalRef("EXT-100");
      expect(matches).toHaveLength(2);
      expect(matches.map((i) => i.title).sort()).toEqual(["ADR 1", "PRD 1"]);
    });
  });

  // ── Traces ─────────────────────────────────────────────────────────────

  describe("traces", () => {
    let pmNodeId: string;
    let devNodeId: string;
    let pmItemId: string;
    let devItemId: string;

    beforeEach(() => {
      const pmNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "a", isAI: false });
      const devNode = store.createNode({ name: "Dev", vertical: "dev", project: "p1", owner: "b", isAI: false });
      pmNodeId = pmNode.id;
      devNodeId = devNode.id;

      const pmItem = store.createItem({ nodeId: pmNodeId, kind: "prd", title: "PRD" });
      const devItem = store.createItem({ nodeId: devNodeId, kind: "tech-design", title: "TD" });
      pmItemId = pmItem.id;
      devItemId = devItem.id;
    });

    it("createTrace + getItemTraces", () => {
      const trace = store.createTrace({
        fromItemId: pmItemId,
        fromNodeId: pmNodeId,
        toItemId: devItemId,
        toNodeId: devNodeId,
        relation: "traced_from",
      });

      expect(trace.id).toBeDefined();
      expect(trace.fromItemId).toBe(pmItemId);
      expect(trace.toItemId).toBe(devItemId);
      expect(trace.relation).toBe("traced_from");

      const traces = store.getItemTraces(devItemId);
      expect(traces).toHaveLength(1);
      expect(traces[0].id).toBe(trace.id);
    });

    it("getDependentTraces finds items that depend on a given item", () => {
      store.createTrace({
        fromItemId: pmItemId,
        fromNodeId: pmNodeId,
        toItemId: devItemId,
        toNodeId: devNodeId,
        relation: "traced_from",
      });

      // devItem depends on pmItem (devItem traces from pmItem)
      // getDependentTraces(pmItemId) should find traces WHERE to_item_id = pmItemId
      // But wait — the trace goes fromItem=PM -> toItem=Dev, meaning Dev traces from PM
      // "dependent" means: items that depend ON the given item
      // If Dev traces_from PM, then Dev depends on PM
      // getDependentTraces(pmItemId) => WHERE to_item_id = pmItemId? No.
      // Actually the spec says: getDependentTraces "finds items that depend on a given item — WHERE to_item_id = ?"
      // This means: traces where to_item_id = givenItem
      // A trace "from A to B" with relation "traced_from" means B is traced from A
      // getDependentTraces(devItemId) => traces WHERE to_item_id = devItemId
      const dependents = store.getDependentTraces(devItemId);
      expect(dependents).toHaveLength(1);
      expect(dependents[0].fromItemId).toBe(pmItemId);
    });

    it("getUpstreamTraces finds traces originating from a given item", () => {
      store.createTrace({
        fromItemId: pmItemId,
        fromNodeId: pmNodeId,
        toItemId: devItemId,
        toNodeId: devNodeId,
        relation: "traced_from",
      });

      const upstream = store.getUpstreamTraces(pmItemId);
      expect(upstream).toHaveLength(1);
      expect(upstream[0].toItemId).toBe(devItemId);
    });
  });

  // ── Transitions ────────────────────────────────────────────────────────

  describe("transitions", () => {
    let itemId: string;

    beforeEach(() => {
      const node = store.createNode({ name: "N", vertical: "dev", project: "p1", owner: "a", isAI: false });
      const item = store.createItem({ nodeId: node.id, kind: "adr", title: "Item" });
      itemId = item.id;
    });

    it("recordTransition + getItemTransitions", () => {
      const t = store.recordTransition({
        itemId,
        kind: "verify",
        from: "unverified",
        to: "proven",
        evidence: "test-results.md",
        reason: "All tests pass",
        actor: "alice",
      });

      expect(t.id).toBeDefined();
      expect(t.itemId).toBe(itemId);
      expect(t.kind).toBe("verify");
      expect(t.from).toBe("unverified");
      expect(t.to).toBe("proven");
      expect(t.evidence).toBe("test-results.md");
      expect(t.reason).toBe("All tests pass");
      expect(t.actor).toBe("alice");
      expect(t.timestamp).toBeDefined();

      const transitions = store.getItemTransitions(itemId);
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual(t);
    });
  });

  // ── Signals ────────────────────────────────────────────────────────────

  describe("signals", () => {
    it("createSignal + markSignalProcessed", () => {
      const signal = store.createSignal({
        kind: "change",
        sourceItem: "item-1",
        sourceNode: "node-1",
        targetItem: "item-2",
        targetNode: "node-2",
        payload: JSON.stringify({ detail: "state changed" }),
      });

      expect(signal.id).toBeDefined();
      expect(signal.kind).toBe("change");
      expect(signal.processed).toBe(false);

      store.markSignalProcessed(signal.id);

      // We don't have a getSignal, but we can verify by checking the DB indirectly
      // For now, just ensure no error is thrown
    });
  });

  // ── Queries ────────────────────────────────────────────────────────────

  describe("queries", () => {
    it("createQuery + createQueryResponse", () => {
      const query = store.createQuery({
        askerId: "user-1",
        askerNode: "node-1",
        question: "Is the API spec up to date?",
        context: "Reviewing the design",
        targetNode: "node-2",
      });

      expect(query.id).toBeDefined();
      expect(query.askerId).toBe("user-1");
      expect(query.question).toBe("Is the API spec up to date?");
      expect(query.resolved).toBe(false);

      const response = store.createQueryResponse({
        queryId: query.id,
        responderId: "user-2",
        nodeId: "node-2",
        answer: "Yes, it was updated yesterday",
        isAI: false,
      });

      expect(response.id).toBeDefined();
      expect(response.queryId).toBe(query.id);
      expect(response.answer).toBe("Yes, it was updated yesterday");
      expect(response.isAI).toBe(false);
    });
  });

  // ── Pending Actions ────────────────────────────────────────────────────

  describe("pending actions", () => {
    it("createPendingAction + listPendingActions", () => {
      store.createPendingAction({
        messageType: "signal_change",
        envelope: JSON.stringify({ data: "test" }),
        summary: "Item state changed",
        proposed: "Mark as suspect",
      });
      store.createPendingAction({
        messageType: "sweep",
        envelope: JSON.stringify({ data: "test2" }),
        summary: "External ref updated",
        proposed: "Update item",
      });

      const pending = store.listPendingActions();
      expect(pending).toHaveLength(2);
      expect(pending[0].status).toBe("pending");
      expect(pending[1].status).toBe("pending");
    });

    it("updatePendingActionStatus changes status", () => {
      const action = store.createPendingAction({
        messageType: "signal_change",
        envelope: "{}",
        summary: "Test",
        proposed: "Do something",
      });

      store.updatePendingActionStatus(action.id, "approved");

      // After approval, it should not appear in pending list
      const pending = store.listPendingActions();
      expect(pending).toHaveLength(0);
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────────

  describe("audit", () => {
    it("returns correct counts and categorizes items", () => {
      const node = store.createNode({ name: "Dev", vertical: "dev", project: "p1", owner: "a", isAI: false });
      const otherNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "b", isAI: false });

      // Create items in various states
      const item1 = store.createItem({ nodeId: node.id, kind: "adr", title: "Unverified ADR" });
      const item2 = store.createItem({ nodeId: node.id, kind: "tech-design", title: "Proven TD" });
      store.updateItemStatus(item2.id, "proven", "evidence", "alice");
      const item3 = store.createItem({ nodeId: node.id, kind: "api-spec", title: "Suspect Spec" });
      store.updateItemStatus(item3.id, "proven", "ev", "bob");
      store.updateItemStatus(item3.id, "suspect", "", "");
      const item4 = store.createItem({ nodeId: node.id, kind: "data-model", title: "Broke DM" });
      store.updateItemStatus(item4.id, "proven", "ev", "bob");
      store.updateItemStatus(item4.id, "suspect", "", "");
      store.updateItemStatus(item4.id, "broke", "", "");

      // item2 has a trace (not orphan), item1 has no trace (orphan)
      const otherItem = store.createItem({ nodeId: otherNode.id, kind: "prd", title: "PRD" });
      store.createTrace({
        fromItemId: otherItem.id,
        fromNodeId: otherNode.id,
        toItemId: item2.id,
        toNodeId: node.id,
        relation: "traced_from",
      });

      const report = store.audit(node.id);

      expect(report.nodeId).toBe(node.id);
      expect(report.totalItems).toBe(4);
      expect(report.unverified).toContain(item1.id);
      expect(report.proven).toContain(item2.id);
      expect(report.suspect).toContain(item3.id);
      expect(report.broke).toContain(item4.id);
      // item1, item3, item4 have no traces — orphans
      expect(report.orphans).toContain(item1.id);
      expect(report.orphans).toContain(item3.id);
      expect(report.orphans).toContain(item4.id);
      expect(report.orphans).not.toContain(item2.id);
    });

    it("reports missingUpstreamRefs for items in non-root verticals without upstream traces", () => {
      // dev vertical has upstream: pm, design
      const devNode = store.createNode({ name: "Dev", vertical: "dev", project: "p1", owner: "a", isAI: false });
      const pmNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "b", isAI: false });

      const devItem = store.createItem({ nodeId: devNode.id, kind: "tech-design", title: "TD" });
      const pmItem = store.createItem({ nodeId: pmNode.id, kind: "prd", title: "PRD" });

      // devItem has no upstream trace from a pm or design node => missingUpstreamRef
      const report1 = store.audit(devNode.id);
      expect(report1.missingUpstreamRefs).toContain(devItem.id);

      // Now add a trace from pmItem to devItem
      store.createTrace({
        fromItemId: pmItem.id,
        fromNodeId: pmNode.id,
        toItemId: devItem.id,
        toNodeId: devNode.id,
        relation: "traced_from",
      });

      const report2 = store.audit(devNode.id);
      expect(report2.missingUpstreamRefs).not.toContain(devItem.id);
    });

    it("pm vertical has no missingUpstreamRefs (root vertical)", () => {
      const pmNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "a", isAI: false });
      store.createItem({ nodeId: pmNode.id, kind: "prd", title: "PRD" });

      const report = store.audit(pmNode.id);
      expect(report.missingUpstreamRefs).toHaveLength(0);
    });
  });

  // ── Change Requests ─────────────────────────────────────────────────────

  describe("change requests", () => {
    let pmNode: Node;
    let devNode: Node;

    beforeEach(() => {
      pmNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "alice", isAI: false });
      devNode = store.createNode({ name: "Dev", vertical: "dev", project: "p1", owner: "bob", isAI: false });
    });

    it("creates a CR in draft status", () => {
      const cr = store.createChangeRequest({
        proposerNode: pmNode.id,
        proposerId: "alice",
        targetItemId: "item-123",
        description: "Update the PRD scope",
      });

      expect(cr.id).toBeDefined();
      expect(cr.proposerNode).toBe(pmNode.id);
      expect(cr.proposerId).toBe("alice");
      expect(cr.targetItemId).toBe("item-123");
      expect(cr.description).toBe("Update the PRD scope");
      expect(cr.status).toBe("draft");
      expect(cr.createdAt).toBeDefined();
      expect(cr.updatedAt).toBeDefined();
    });

    it("updates CR status", () => {
      const cr = store.createChangeRequest({
        proposerNode: pmNode.id,
        proposerId: "alice",
        targetItemId: "item-123",
        description: "Change scope",
      });
      expect(cr.status).toBe("draft");

      const updated = store.updateChangeRequestStatus(cr.id, "proposed");
      expect(updated.status).toBe("proposed");
      expect(updated.id).toBe(cr.id);
      expect(updated.updatedAt).toBeDefined();
    });

    it("gets CR by id", () => {
      const cr = store.createChangeRequest({
        proposerNode: pmNode.id,
        proposerId: "alice",
        targetItemId: "item-123",
        description: "Some change",
      });

      const fetched = store.getChangeRequest(cr.id);
      expect(fetched).toEqual(cr);

      const missing = store.getChangeRequest("nonexistent");
      expect(missing).toBeNull();
    });

    it("lists CRs by status", () => {
      store.createChangeRequest({
        proposerNode: pmNode.id,
        proposerId: "alice",
        targetItemId: "item-1",
        description: "CR 1",
      });
      const cr2 = store.createChangeRequest({
        proposerNode: devNode.id,
        proposerId: "bob",
        targetItemId: "item-2",
        description: "CR 2",
      });
      store.updateChangeRequestStatus(cr2.id, "proposed");

      const drafts = store.listChangeRequests("draft");
      expect(drafts).toHaveLength(1);
      expect(drafts[0].description).toBe("CR 1");

      const proposed = store.listChangeRequests("proposed");
      expect(proposed).toHaveLength(1);
      expect(proposed[0].description).toBe("CR 2");

      const all = store.listChangeRequests();
      expect(all).toHaveLength(2);
    });
  });

  // ── Votes ───────────────────────────────────────────────────────────────

  describe("votes", () => {
    let pmNode: Node;
    let devNode: Node;
    let qaNode: Node;
    let crId: string;

    beforeEach(() => {
      pmNode = store.createNode({ name: "PM", vertical: "pm", project: "p1", owner: "alice", isAI: false });
      devNode = store.createNode({ name: "Dev", vertical: "dev", project: "p1", owner: "bob", isAI: false });
      qaNode = store.createNode({ name: "QA", vertical: "qa", project: "p1", owner: "carol", isAI: false });

      const cr = store.createChangeRequest({
        proposerNode: pmNode.id,
        proposerId: "alice",
        targetItemId: "item-1",
        description: "Change something",
      });
      crId = cr.id;
    });

    it("creates a vote for a CR", () => {
      const vote = store.createVote({
        crId,
        nodeId: devNode.id,
        vertical: "dev",
        approve: true,
        reason: "Looks good",
      });

      expect(vote.id).toBeDefined();
      expect(vote.crId).toBe(crId);
      expect(vote.nodeId).toBe(devNode.id);
      expect(vote.vertical).toBe("dev");
      expect(vote.approve).toBe(true);
      expect(vote.reason).toBe("Looks good");
      expect(vote.createdAt).toBeDefined();
    });

    it("lists votes for a CR", () => {
      store.createVote({ crId, nodeId: devNode.id, vertical: "dev", approve: true, reason: "LGTM" });
      store.createVote({ crId, nodeId: qaNode.id, vertical: "qa", approve: false, reason: "Needs tests" });

      const votes = store.listVotes(crId);
      expect(votes).toHaveLength(2);
    });

    it("tallies votes correctly", () => {
      store.createVote({ crId, nodeId: devNode.id, vertical: "dev", approve: true, reason: "Yes" });
      store.createVote({ crId, nodeId: qaNode.id, vertical: "qa", approve: false, reason: "No" });
      store.createVote({ crId, nodeId: pmNode.id, vertical: "pm", approve: true, reason: "Agree" });

      const tally = store.tallyVotes(crId);
      expect(tally.approved).toBe(2);
      expect(tally.rejected).toBe(1);
      expect(tally.total).toBe(3);
    });

    it("prevents duplicate votes from same node (UNIQUE constraint)", () => {
      store.createVote({ crId, nodeId: devNode.id, vertical: "dev", approve: true, reason: "First vote" });

      expect(() => {
        store.createVote({ crId, nodeId: devNode.id, vertical: "dev", approve: false, reason: "Second vote" });
      }).toThrow();
    });
  });
});
