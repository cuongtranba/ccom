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
  ChangeRequest,
  Vote,
  CRTransitionKind,
  PairSession,
  ChecklistItem,
  KindMapping,
} from "@inv/shared";
import { UPSTREAM_VERTICALS } from "@inv/shared";
import type { Store } from "./store";
import type { StateMachine } from "./state";
import { CRStateMachine } from "./state";
import type { SignalPropagator } from "./signal";

export interface SweepResult {
  triggerRef: string;
  matchedItems: Item[];
  affectedItems: Item[];
  signalsCreated: number;
}

export class Engine {
  private crSm = new CRStateMachine();

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

  // ── Proposals & Voting ──────────────────────────────────────────────

  createProposal(
    proposerNode: string,
    proposerId: string,
    targetItemId: string,
    description: string,
  ): ChangeRequest {
    this.getItem(targetItemId); // validate item exists
    return this.store.createChangeRequest({ proposerNode, proposerId, targetItemId, description });
  }

  submitProposal(crId: string): ChangeRequest {
    const cr = this.getChangeRequest(crId);
    this.crSm.apply(cr.status, "submit");
    return this.store.updateChangeRequestStatus(crId, "proposed");
  }

  openVoting(crId: string): ChangeRequest {
    const cr = this.getChangeRequest(crId);
    this.crSm.apply(cr.status, "open_voting");
    return this.store.updateChangeRequestStatus(crId, "voting");
  }

  castVote(
    crId: string,
    nodeId: string,
    vertical: Vertical,
    approve: boolean,
    reason: string,
  ): Vote {
    const cr = this.getChangeRequest(crId);
    if (cr.status !== "voting") {
      throw new Error(`Cannot vote on CR in "${cr.status}" status`);
    }
    return this.store.createVote({ crId, nodeId, vertical, approve, reason });
  }

  resolveVoting(crId: string): ChangeRequest {
    const cr = this.getChangeRequest(crId);
    if (cr.status !== "voting") {
      throw new Error(`Cannot resolve CR in "${cr.status}" status`);
    }

    const tally = this.store.tallyVotes(crId);

    let approved: boolean;
    if (tally.approved > tally.rejected) {
      approved = true;
    } else if (tally.rejected > tally.approved) {
      approved = false;
    } else {
      approved = this.tieBreak(cr);
    }

    const kind: CRTransitionKind = approved ? "approve" : "reject";
    this.crSm.apply(cr.status, kind);
    return this.store.updateChangeRequestStatus(crId, approved ? "approved" : "rejected");
  }

  applyProposal(crId: string): { cr: ChangeRequest; signals: Signal[] } {
    const cr = this.getChangeRequest(crId);
    this.crSm.apply(cr.status, "apply");
    const updated = this.store.updateChangeRequestStatus(crId, "applied");
    const signals = this.propagator.propagateChange(cr.targetItemId);
    return { cr: updated, signals };
  }

  archiveProposal(crId: string): ChangeRequest {
    const cr = this.getChangeRequest(crId);
    this.crSm.apply(cr.status, "archive");
    return this.store.updateChangeRequestStatus(crId, "archived");
  }

  // ── Challenges ──────────────────────────────────────────────────────

  createChallenge(
    challengerNode: string,
    challengerId: string,
    targetItemId: string,
    reason: string,
  ): ChangeRequest {
    this.getItem(targetItemId); // validate
    return this.store.createChangeRequest({
      proposerNode: challengerNode,
      proposerId: challengerId,
      targetItemId,
      description: `Challenge: ${reason}`,
    });
  }

  upholdChallenge(crId: string): { cr: ChangeRequest; signals: Signal[] } {
    const cr = this.getChangeRequest(crId);
    if (cr.status !== "approved") {
      throw new Error(`Cannot uphold challenge in "${cr.status}" status — must be approved`);
    }

    // Mark the challenged item as suspect
    const item = this.getItem(cr.targetItemId);
    if (item.state === "proven") {
      this.store.updateItemStatus(cr.targetItemId, "suspect", `Challenge upheld: ${cr.description}`, "challenge-system");
      this.store.recordTransition({
        itemId: cr.targetItemId,
        kind: "suspect",
        from: "proven",
        to: "suspect",
        evidence: cr.description,
        reason: "Challenge upheld by vote",
        actor: "challenge-system",
      });
    }

    // Apply and propagate
    this.crSm.apply(cr.status, "apply");
    const updated = this.store.updateChangeRequestStatus(crId, "applied");
    const signals = this.propagator.propagateChange(cr.targetItemId);

    return { cr: updated, signals };
  }

  dismissChallenge(crId: string): ChangeRequest {
    const cr = this.getChangeRequest(crId);
    if (cr.status !== "rejected") {
      throw new Error(`Cannot dismiss challenge in "${cr.status}" status — must be rejected`);
    }
    this.crSm.apply(cr.status, "archive");
    return this.store.updateChangeRequestStatus(crId, "archived");
  }

  // ── Pairing ─────────────────────────────────────────────────────────

  invitePair(initiatorNode: string, partnerNode: string, project: string): PairSession {
    this.getNode(initiatorNode);
    this.getNode(partnerNode);
    return this.store.createPairSession({ initiatorNode, partnerNode, project });
  }

  joinPair(sessionId: string): PairSession {
    const session = this.store.getPairSession(sessionId);
    if (!session) throw new Error(`Pair session not found: ${sessionId}`);
    if (session.status !== "pending") throw new Error(`Session is "${session.status}", cannot join`);
    return this.store.updatePairSessionStatus(sessionId, "active");
  }

  endPair(sessionId: string): PairSession {
    const session = this.store.getPairSession(sessionId);
    if (!session) throw new Error(`Pair session not found: ${sessionId}`);
    if (session.status !== "active") throw new Error(`Session is "${session.status}", cannot end`);
    return this.store.updatePairSessionStatus(sessionId, "ended");
  }

  listPairSessions(nodeId: string): PairSession[] {
    return this.store.listPairSessions(nodeId);
  }

  // ── Checklists ──────────────────────────────────────────────────────

  addChecklistItem(itemId: string, text: string): ChecklistItem {
    this.getItem(itemId);
    return this.store.createChecklistItem({ itemId, text });
  }

  checkChecklistItem(checklistItemId: string): void {
    this.store.updateChecklistItemChecked(checklistItemId, true);
  }

  uncheckChecklistItem(checklistItemId: string): void {
    this.store.updateChecklistItemChecked(checklistItemId, false);
  }

  listChecklist(itemId: string): ChecklistItem[] {
    return this.store.listChecklistItems(itemId);
  }

  // ── Kind Mappings ───────────────────────────────────────────────────

  addKindMapping(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical, toKind: ItemKind): KindMapping {
    return this.store.createKindMapping({ fromVertical, fromKind, toVertical, toKind });
  }

  getMappedKind(fromVertical: Vertical, fromKind: ItemKind, toVertical: Vertical): ItemKind | null {
    return this.store.getMappedKind(fromVertical, fromKind, toVertical);
  }

  private getChangeRequest(id: string): ChangeRequest {
    const cr = this.store.getChangeRequest(id);
    if (!cr) throw new Error(`Change request not found: ${id}`);
    return cr;
  }

  private tieBreak(cr: ChangeRequest): boolean {
    const proposerNode = this.store.getNode(cr.proposerNode);
    if (!proposerNode) return false;

    const upstreams = UPSTREAM_VERTICALS[proposerNode.vertical];
    const votes = this.store.listVotes(cr.id);
    for (const vote of votes) {
      if (upstreams.includes(vote.vertical) && vote.approve) {
        return true;
      }
    }
    return false;
  }
}
