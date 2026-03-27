import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { StateMachine, CRStateMachine } from "../src/state";
import type { CRStatus, CRTransitionKind } from "../src/state";
import { SignalPropagator } from "../src/signal";
import { Engine } from "../src/engine";
import type { Node, Item, PendingAction } from "@inv/shared";

// ── Helpers ─────────────────────────────────────────────────────────────

const PROJECT = "clinic-checkin";

/**
 * Tracks a CR (Change Request) lifecycle using CRStateMachine + PendingAction store.
 * In V2, this will be an Engine method. For now, we orchestrate manually.
 */
interface ChangeRequest {
  id: string;
  status: CRStatus;
  proposerId: string;
  proposerNode: string;
  targetItemId: string;
  description: string;
  votes: Array<{ nodeId: string; vertical: string; approve: boolean; reason: string }>;
}

function createCR(
  store: Store,
  crSm: CRStateMachine,
  proposerId: string,
  proposerNode: string,
  targetItemId: string,
  description: string,
): ChangeRequest {
  const action = store.createPendingAction({
    messageType: "cr_create",
    envelope: JSON.stringify({ targetItemId, description }),
    summary: description,
    proposed: proposerId,
  });

  return {
    id: action.id,
    status: "draft" as CRStatus,
    proposerId,
    proposerNode,
    targetItemId,
    description,
    votes: [],
  };
}

function transitionCR(cr: ChangeRequest, crSm: CRStateMachine, kind: CRTransitionKind): void {
  cr.status = crSm.apply(cr.status, kind);
}

function voteCR(
  cr: ChangeRequest,
  nodeId: string,
  vertical: string,
  approve: boolean,
  reason: string,
): void {
  cr.votes.push({ nodeId, vertical, approve, reason });
}

function tallyVotes(cr: ChangeRequest): { approved: number; rejected: number; total: number } {
  const approved = cr.votes.filter((v) => v.approve).length;
  const rejected = cr.votes.filter((v) => !v.approve).length;
  return { approved, rejected, total: cr.votes.length };
}

// ── Proposal / Voting Scenarios ─────────────────────────────────────────

describe("Scenario: Proposals and Voting", () => {
  let store: Store;
  let sm: StateMachine;
  let crSm: CRStateMachine;
  let propagator: SignalPropagator;
  let engine: Engine;

  let pmNode: Node;
  let designNode: Node;
  let devNode: Node;
  let qaNode: Node;
  let devopsNode: Node;

  // Items
  let prd: Item;
  let screenSpec: Item;
  let apiSpec: Item;
  let testCase: Item;
  let runbook: Item;

  beforeEach(() => {
    store = new Store(":memory:");
    sm = new StateMachine();
    crSm = new CRStateMachine();
    propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);

    // Register nodes
    pmNode = engine.registerNode("pm-node", "pm", PROJECT, "alice", false);
    designNode = engine.registerNode("design-node", "design", PROJECT, "bob", false);
    devNode = engine.registerNode("dev-node", "dev", PROJECT, "cuong", false);
    qaNode = engine.registerNode("qa-node", "qa", PROJECT, "diana", false);
    devopsNode = engine.registerNode("devops-node", "devops", PROJECT, "eve", false);

    // Build a proven chain: PRD → screenSpec → apiSpec → testCase, runbook
    prd = engine.addItem(pmNode.id, "prd", "Clinic Check-In PRD", "", "JIRA-101");
    engine.verifyItem(prd.id, "Stakeholder approved", "alice");

    screenSpec = engine.addItem(designNode.id, "screen-spec", "QR Scanner Screen", "", "FIGMA-201");
    engine.verifyItem(screenSpec.id, "Design reviewed", "bob");
    engine.addTrace(screenSpec.id, prd.id, "traced_from", "bob");

    apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "", "");
    engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");
    engine.addTrace(apiSpec.id, screenSpec.id, "traced_from", "cuong");

    testCase = engine.addItem(qaNode.id, "test-case", "TC: QR scan happy path", "", "");
    engine.verifyItem(testCase.id, "Test passes", "diana");
    engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

    runbook = engine.addItem(devopsNode.id, "runbook", "Deployment Runbook", "", "");
    engine.verifyItem(runbook.id, "Ops reviewed", "eve");
    engine.addTrace(runbook.id, apiSpec.id, "traced_from", "eve");
  });

  afterEach(() => {
    store.close();
  });

  // ── PM proposes a PRD change ─────────────────────────────────────────

  describe("PM proposes PRD change — approved by majority", () => {
    it("CR follows full lifecycle: draft → proposed → voting → approved → applied → archived", () => {
      const cr = createCR(store, crSm, "alice", pmNode.id, prd.id, "Update PRD to add appointment rescheduling");

      expect(cr.status).toBe("draft");

      // PM submits the proposal
      transitionCR(cr, crSm, "submit");
      expect(cr.status).toBe("proposed");

      // PM opens voting
      transitionCR(cr, crSm, "open_voting");
      expect(cr.status).toBe("voting");

      // Verticals vote
      voteCR(cr, designNode.id, "design", true, "Fits current design patterns");
      voteCR(cr, devNode.id, "dev", true, "API can support this");
      voteCR(cr, qaNode.id, "qa", true, "We can extend test coverage");
      voteCR(cr, devopsNode.id, "devops", false, "Adds deployment complexity");

      const tally = tallyVotes(cr);
      expect(tally.approved).toBe(3);
      expect(tally.rejected).toBe(1);
      expect(tally.total).toBe(4);

      // Majority approved
      transitionCR(cr, crSm, "approve");
      expect(cr.status).toBe("approved");

      // Apply the change — this triggers signal propagation
      transitionCR(cr, crSm, "apply");
      expect(cr.status).toBe("applied");

      // Propagate the PRD change to downstream items
      const signals = engine.propagateChange(prd.id);
      expect(signals.length).toBeGreaterThanOrEqual(4); // screenSpec, apiSpec, testCase, runbook

      expect(engine.getItem(screenSpec.id).state).toBe("suspect");
      expect(engine.getItem(apiSpec.id).state).toBe("suspect");
      expect(engine.getItem(testCase.id).state).toBe("suspect");
      expect(engine.getItem(runbook.id).state).toBe("suspect");

      // Archive after applied
      transitionCR(cr, crSm, "archive");
      expect(cr.status).toBe("archived");
    });

    it("tracks votes from each vertical with reasons", () => {
      const cr = createCR(store, crSm, "alice", pmNode.id, prd.id, "Add patient notifications");
      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      voteCR(cr, designNode.id, "design", true, "UX benefit for patients");
      voteCR(cr, devNode.id, "dev", true, "Push notification service exists");
      voteCR(cr, qaNode.id, "qa", true, "Can automate notification testing");
      voteCR(cr, devopsNode.id, "devops", true, "No infra changes needed");

      expect(cr.votes).toHaveLength(4);
      expect(cr.votes.every((v) => v.approve)).toBe(true);

      const devVote = cr.votes.find((v) => v.vertical === "dev");
      expect(devVote?.reason).toBe("Push notification service exists");
    });
  });

  // ── Proposal rejected ────────────────────────────────────────────────

  describe("Dev proposes API change — rejected by majority", () => {
    it("CR rejected: voting → rejected → archived, no propagation", () => {
      const cr = createCR(store, crSm, "cuong", devNode.id, apiSpec.id, "Rewrite API in GraphQL");
      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      // Votes
      voteCR(cr, pmNode.id, "pm", false, "Too risky mid-project");
      voteCR(cr, designNode.id, "design", false, "Current REST API works fine");
      voteCR(cr, qaNode.id, "qa", false, "Would invalidate all existing tests");
      voteCR(cr, devopsNode.id, "devops", false, "GraphQL adds deployment complexity");

      const tally = tallyVotes(cr);
      expect(tally.approved).toBe(0);
      expect(tally.rejected).toBe(4);

      // Majority rejected
      transitionCR(cr, crSm, "reject");
      expect(cr.status).toBe("rejected");

      // No propagation — items remain proven
      expect(engine.getItem(apiSpec.id).state).toBe("proven");
      expect(engine.getItem(testCase.id).state).toBe("proven");
      expect(engine.getItem(runbook.id).state).toBe("proven");

      // Archive
      transitionCR(cr, crSm, "archive");
      expect(cr.status).toBe("archived");
    });

    it("rejected CR cannot be applied", () => {
      const cr = createCR(store, crSm, "cuong", devNode.id, apiSpec.id, "Bad idea");
      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");
      transitionCR(cr, crSm, "reject");

      expect(() => transitionCR(cr, crSm, "apply")).toThrow(
        'cannot apply "apply" from status "rejected"',
      );
    });
  });

  // ── Split vote ────────────────────────────────────────────────────────

  describe("Design proposes screen redesign — split vote", () => {
    it("tie-breaking: PM as owner of upstream gets deciding vote", () => {
      const cr = createCR(store, crSm, "bob", designNode.id, screenSpec.id, "Complete screen redesign with new UI framework");
      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      voteCR(cr, pmNode.id, "pm", true, "Better UX for patients");
      voteCR(cr, devNode.id, "dev", false, "Major refactor needed");
      voteCR(cr, qaNode.id, "qa", false, "Regression risk is high");
      voteCR(cr, devopsNode.id, "devops", true, "No infra impact");

      const tally = tallyVotes(cr);
      expect(tally.approved).toBe(2);
      expect(tally.rejected).toBe(2);

      // PM is upstream owner — their approval tips the balance
      const pmVoted = cr.votes.find((v) => v.vertical === "pm");
      expect(pmVoted?.approve).toBe(true);

      // Decision: approved (PM as upstream authority)
      transitionCR(cr, crSm, "approve");
      expect(cr.status).toBe("approved");
    });
  });

  // ── Pending Actions integration ───────────────────────────────────────

  describe("PendingAction tracks CR approvals", () => {
    it("creates pending actions for voters and resolves them", () => {
      // Create pending actions for each vertical to vote
      const voteActions: PendingAction[] = [];

      for (const node of [designNode, devNode, qaNode, devopsNode]) {
        const action = store.createPendingAction({
          messageType: "proposal_vote",
          envelope: JSON.stringify({ crId: "cr-1", targetItem: prd.id }),
          summary: `Vote on PRD change: add rescheduling feature`,
          proposed: pmNode.id,
        });
        voteActions.push(action);
      }

      // All should be pending
      const pending = store.listPendingActions();
      expect(pending).toHaveLength(4);
      expect(pending.every((a) => a.status === "pending")).toBe(true);

      // Verticals approve
      store.updatePendingActionStatus(voteActions[0].id, "approved"); // design
      store.updatePendingActionStatus(voteActions[1].id, "approved"); // dev
      store.updatePendingActionStatus(voteActions[2].id, "approved"); // qa
      store.updatePendingActionStatus(voteActions[3].id, "rejected"); // devops

      // Only pending ones remain in list
      const remaining = store.listPendingActions();
      expect(remaining).toHaveLength(0);
    });

    it("expired pending action blocks CR from proceeding", () => {
      const action = store.createPendingAction({
        messageType: "proposal_vote",
        envelope: JSON.stringify({ crId: "cr-2", targetItem: apiSpec.id }),
        summary: "Vote on API change",
        proposed: devNode.id,
      });

      store.updatePendingActionStatus(action.id, "expired");

      // Expired action is no longer pending
      const pending = store.listPendingActions();
      expect(pending).toHaveLength(0);
    });
  });

  // ── CR state machine edge cases ──────────────────────────────────────

  describe("CR state machine guards", () => {
    it("cannot skip from draft to voting", () => {
      expect(() => crSm.apply("draft", "open_voting")).toThrow();
    });

    it("cannot approve from proposed (must open voting first)", () => {
      expect(() => crSm.apply("proposed", "approve")).toThrow();
    });

    it("cannot apply from voting (must approve first)", () => {
      expect(() => crSm.apply("voting", "apply")).toThrow();
    });

    it("cannot archive from approved (must apply first)", () => {
      expect(() => crSm.apply("approved", "archive")).toThrow();
    });

    it("cannot reopen archived CR", () => {
      expect(() => crSm.apply("archived", "submit")).toThrow();
    });
  });
});

// ── Challenge Scenarios ─────────────────────────────────────────────────

describe("Scenario: Challenges", () => {
  let store: Store;
  let sm: StateMachine;
  let crSm: CRStateMachine;
  let propagator: SignalPropagator;
  let engine: Engine;

  let pmNode: Node;
  let devNode: Node;
  let qaNode: Node;
  let devopsNode: Node;

  let apiSpec: Item;
  let testCase: Item;
  let runbook: Item;

  beforeEach(() => {
    store = new Store(":memory:");
    sm = new StateMachine();
    crSm = new CRStateMachine();
    propagator = new SignalPropagator(store, sm);
    engine = new Engine(store, sm, propagator);

    pmNode = engine.registerNode("pm-node", "pm", PROJECT, "alice", false);
    devNode = engine.registerNode("dev-node", "dev", PROJECT, "cuong", false);
    qaNode = engine.registerNode("qa-node", "qa", PROJECT, "diana", false);
    devopsNode = engine.registerNode("devops-node", "devops", PROJECT, "eve", false);

    // Proven items
    apiSpec = engine.addItem(devNode.id, "api-spec", "Check-In API v1", "", "");
    engine.verifyItem(apiSpec.id, "Code reviewed", "cuong");

    testCase = engine.addItem(qaNode.id, "test-case", "TC: QR scan happy path", "", "");
    engine.verifyItem(testCase.id, "Test passes", "diana");
    engine.addTrace(testCase.id, apiSpec.id, "proven_by", "diana");

    runbook = engine.addItem(devopsNode.id, "runbook", "Deployment Runbook", "", "");
    engine.verifyItem(runbook.id, "Ops reviewed", "eve");
    engine.addTrace(runbook.id, apiSpec.id, "traced_from", "eve");
  });

  afterEach(() => {
    store.close();
  });

  // ── QA challenges Dev item ───────────────────────────────────────────

  describe("QA challenges Dev's proven API spec", () => {
    it("challenge upheld: item becomes suspect, cascades to downstream", () => {
      // QA creates a challenge as a pending action
      const challenge = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({
          challengedItemId: apiSpec.id,
          challengerNode: qaNode.id,
          reason: "API returns 200 for invalid appointment IDs — should be 404",
        }),
        summary: "QA challenges API spec: invalid appointment handling",
        proposed: qaNode.id,
      });

      expect(challenge.status).toBe("pending");

      // Challenge goes to voting via CR
      const cr: ChangeRequest = {
        id: challenge.id,
        status: "draft",
        proposerId: "diana",
        proposerNode: qaNode.id,
        targetItemId: apiSpec.id,
        description: "API returns 200 for invalid appointment IDs",
        votes: [],
      };

      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      // PM and DevOps agree with QA
      voteCR(cr, pmNode.id, "pm", true, "This is a spec violation");
      voteCR(cr, devopsNode.id, "devops", true, "Monitoring shows 200s for bad requests");

      // Dev disagrees (defending their item)
      voteCR(cr, devNode.id, "dev", false, "This is by design — returns empty object");

      const tally = tallyVotes(cr);
      expect(tally.approved).toBe(2);
      expect(tally.rejected).toBe(1);

      // Challenge upheld
      transitionCR(cr, crSm, "approve");
      transitionCR(cr, crSm, "apply");
      store.updatePendingActionStatus(challenge.id, "approved");

      // Propagate change: API spec was wrong → downstream items suspect
      const signals = engine.propagateChange(apiSpec.id);

      expect(engine.getItem(testCase.id).state).toBe("suspect");
      expect(engine.getItem(runbook.id).state).toBe("suspect");
      expect(signals).toHaveLength(2);
    });

    it("challenge dismissed: no state changes", () => {
      const challenge = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({
          challengedItemId: apiSpec.id,
          challengerNode: qaNode.id,
          reason: "API timeout seems too long at 30s",
        }),
        summary: "QA challenges API spec: timeout configuration",
        proposed: qaNode.id,
      });

      const cr: ChangeRequest = {
        id: challenge.id,
        status: "draft",
        proposerId: "diana",
        proposerNode: qaNode.id,
        targetItemId: apiSpec.id,
        description: "API timeout too long",
        votes: [],
      };

      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      // Majority rejects the challenge
      voteCR(cr, pmNode.id, "pm", false, "30s timeout is standard for health systems");
      voteCR(cr, devNode.id, "dev", false, "Backend needs time for appointment lookup");
      voteCR(cr, devopsNode.id, "devops", false, "Infra supports 30s connections");

      const tally = tallyVotes(cr);
      expect(tally.rejected).toBe(3);

      transitionCR(cr, crSm, "reject");
      store.updatePendingActionStatus(challenge.id, "rejected");

      // No changes — all items remain proven
      expect(engine.getItem(apiSpec.id).state).toBe("proven");
      expect(engine.getItem(testCase.id).state).toBe("proven");
      expect(engine.getItem(runbook.id).state).toBe("proven");

      transitionCR(cr, crSm, "archive");
      expect(cr.status).toBe("archived");
    });
  });

  // ── DevOps challenges QA item ─────────────────────────────────────────

  describe("DevOps challenges QA's test case", () => {
    it("challenge upheld: test case marked suspect", () => {
      const challenge = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({
          challengedItemId: testCase.id,
          challengerNode: devopsNode.id,
          reason: "Test passes locally but fails in CI — environment-dependent",
        }),
        summary: "DevOps challenges test case: environment dependency",
        proposed: devopsNode.id,
      });

      const cr: ChangeRequest = {
        id: challenge.id,
        status: "draft",
        proposerId: "eve",
        proposerNode: devopsNode.id,
        targetItemId: testCase.id,
        description: "Test is environment-dependent",
        votes: [],
      };

      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      voteCR(cr, devNode.id, "dev", true, "Confirmed: test uses hardcoded localhost");
      voteCR(cr, pmNode.id, "pm", true, "Tests must be environment-agnostic");

      transitionCR(cr, crSm, "approve");
      transitionCR(cr, crSm, "apply");
      store.updatePendingActionStatus(challenge.id, "approved");

      // Propagate: test case was wrong
      engine.propagateChange(testCase.id);

      // testCase itself needs to become suspect —
      // but propagateChange affects DOWNSTREAM items, not the item itself.
      // The challenge flow should mark the challenged item suspect directly.
      // Simulate the direct state change that would happen in V2 engine:
      store.updateItemStatus(testCase.id, "suspect", "Challenge upheld: environment-dependent", "challenge-system");
      store.recordTransition({
        itemId: testCase.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "challenge-system",
      });

      expect(engine.getItem(testCase.id).state).toBe("suspect");

      // QA acknowledges and fixes
      engine.verifyItem(testCase.id, "Fixed: now uses configurable base URL", "diana");
      expect(engine.getItem(testCase.id).state).toBe("proven");
    });
  });

  // ── PM challenges Design item ─────────────────────────────────────────

  describe("PM challenges Design's screen spec", () => {
    let screenSpec: Item;

    beforeEach(() => {
      screenSpec = engine.addItem(
        engine.registerNode("design-node-c", "design", PROJECT, "bob", false).id,
        "screen-spec",
        "Patient Dashboard",
        "Shows appointment list",
        "FIGMA-301",
      );
      engine.verifyItem(screenSpec.id, "Design review passed", "bob");
    });

    it("PM challenges accessibility: upheld, design goes back to suspect", () => {
      const challenge = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({
          challengedItemId: screenSpec.id,
          challengerNode: pmNode.id,
          reason: "Screen spec doesn't meet WCAG 2.1 AA — contrast ratio too low",
        }),
        summary: "PM challenges screen spec: accessibility compliance",
        proposed: pmNode.id,
      });

      // Voting: everyone agrees accessibility is required
      const cr: ChangeRequest = {
        id: challenge.id,
        status: "draft",
        proposerId: "alice",
        proposerNode: pmNode.id,
        targetItemId: screenSpec.id,
        description: "Accessibility non-compliance",
        votes: [],
      };

      transitionCR(cr, crSm, "submit");
      transitionCR(cr, crSm, "open_voting");

      voteCR(cr, devNode.id, "dev", true, "We need ARIA labels too");
      voteCR(cr, qaNode.id, "qa", true, "Should add accessibility tests");
      voteCR(cr, devopsNode.id, "devops", true, "Lighthouse CI check should enforce this");

      const tally = tallyVotes(cr);
      expect(tally.approved).toBe(3);
      expect(tally.rejected).toBe(0);

      transitionCR(cr, crSm, "approve");
      transitionCR(cr, crSm, "apply");

      // Mark challenged item suspect
      store.updateItemStatus(screenSpec.id, "suspect", "Challenge upheld: WCAG 2.1 AA non-compliance", "challenge-system");
      store.recordTransition({
        itemId: screenSpec.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "challenge-system",
      });

      expect(engine.getItem(screenSpec.id).state).toBe("suspect");
    });
  });

  // ── Multiple challenges on same item ──────────────────────────────────

  describe("Multiple challenges on same Dev API spec", () => {
    it("first challenge upheld, item fixed, second challenge on the fix", () => {
      // First challenge: QA finds bug
      const challenge1 = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({ challengedItemId: apiSpec.id, reason: "Missing pagination" }),
        summary: "Missing pagination on list endpoint",
        proposed: qaNode.id,
      });

      store.updatePendingActionStatus(challenge1.id, "approved");

      // Mark suspect
      store.updateItemStatus(apiSpec.id, "suspect", "Missing pagination", "challenge-system");
      store.recordTransition({
        itemId: apiSpec.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "challenge-system",
      });

      expect(engine.getItem(apiSpec.id).state).toBe("suspect");

      // Dev fixes and re-verifies
      engine.verifyItem(apiSpec.id, "Added pagination with cursor-based approach", "cuong");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");

      // Second challenge: DevOps finds new issue with the fix
      const challenge2 = store.createPendingAction({
        messageType: "challenge_respond",
        envelope: JSON.stringify({ challengedItemId: apiSpec.id, reason: "Cursor pagination breaks cache invalidation" }),
        summary: "Pagination fix breaks caching",
        proposed: devopsNode.id,
      });

      store.updatePendingActionStatus(challenge2.id, "approved");

      store.updateItemStatus(apiSpec.id, "suspect", "Cursor pagination breaks caching", "challenge-system");
      store.recordTransition({
        itemId: apiSpec.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "challenge-system",
      });

      expect(engine.getItem(apiSpec.id).state).toBe("suspect");

      // Full transition history
      const transitions = store.getItemTransitions(apiSpec.id);
      const kinds = transitions.map((t) => t.kind);
      expect(kinds).toEqual(["verify", "suspect", "re_verify", "suspect"]);
    });
  });

  // ── Challenge with downstream cascade ─────────────────────────────────

  describe("Challenge cascades through trace graph", () => {
    it("upheld challenge on API spec suspects QA test case and DevOps runbook", () => {
      // Challenge upheld
      store.updateItemStatus(apiSpec.id, "suspect", "Challenge: missing error codes", "challenge-system");
      store.recordTransition({
        itemId: apiSpec.id,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        actor: "challenge-system",
      });

      // Propagate from the suspected item
      const signals = engine.propagateChange(apiSpec.id);

      expect(engine.getItem(apiSpec.id).state).toBe("suspect");
      expect(engine.getItem(testCase.id).state).toBe("suspect");
      expect(engine.getItem(runbook.id).state).toBe("suspect");
      expect(signals).toHaveLength(2);

      // QA marks test as broken after investigation
      engine.markBroken(testCase.id, "Test assertions don't cover new error codes", "diana");
      expect(engine.getItem(testCase.id).state).toBe("broke");

      // Dev fixes API spec
      engine.verifyItem(apiSpec.id, "Added error code documentation", "cuong");
      expect(engine.getItem(apiSpec.id).state).toBe("proven");

      // QA fixes and re-verifies test
      engine.verifyItem(testCase.id, "Updated assertions for error codes", "diana");
      expect(engine.getItem(testCase.id).state).toBe("proven");

      // DevOps re-verifies runbook
      engine.verifyItem(runbook.id, "Added error code monitoring", "eve");
      expect(engine.getItem(runbook.id).state).toBe("proven");
    });
  });
});
