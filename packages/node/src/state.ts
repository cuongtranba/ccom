import type { ItemState, TransitionKind, CRStatus, CRTransitionKind } from "@inv/shared";

export type { CRStatus, CRTransitionKind };

interface TransitionRule<S extends string, K extends string> {
  from: S;
  kind: K;
  to: S;
}

/**
 * Item state machine with 5 transitions governing the
 * unverified -> proven -> suspect -> broke lifecycle.
 */
export class StateMachine {
  private readonly rules: ReadonlyArray<TransitionRule<ItemState, TransitionKind>> = [
    { from: "unverified", kind: "verify", to: "proven" },
    { from: "proven", kind: "suspect", to: "suspect" },
    { from: "suspect", kind: "re_verify", to: "proven" },
    { from: "suspect", kind: "break", to: "broke" },
    { from: "broke", kind: "fix", to: "proven" },
  ];

  /**
   * Returns whether the given transition kind is valid from the given state.
   */
  canTransition(from: ItemState, kind: TransitionKind): boolean {
    return this.rules.some((r) => r.from === from && r.kind === kind);
  }

  /**
   * Applies a transition, returning the new state.
   * Throws if the transition is invalid.
   */
  apply(from: ItemState, kind: TransitionKind): ItemState {
    const rule = this.rules.find((r) => r.from === from && r.kind === kind);
    if (!rule) {
      throw new Error(
        `Invalid transition: cannot apply "${kind}" from state "${from}"`,
      );
    }
    return rule.to;
  }

  /**
   * Lists all transition kinds available from the given state.
   */
  availableTransitions(from: ItemState): TransitionKind[] {
    return this.rules.filter((r) => r.from === from).map((r) => r.kind);
  }
}

/**
 * Change Request state machine with 7 transitions governing the
 * draft -> proposed -> voting -> approved/rejected -> applied -> archived lifecycle.
 */
export class CRStateMachine {
  private readonly rules: ReadonlyArray<TransitionRule<CRStatus, CRTransitionKind>> = [
    { from: "draft", kind: "submit", to: "proposed" },
    { from: "proposed", kind: "open_voting", to: "voting" },
    { from: "voting", kind: "approve", to: "approved" },
    { from: "voting", kind: "reject", to: "rejected" },
    { from: "approved", kind: "apply", to: "applied" },
    { from: "applied", kind: "archive", to: "archived" },
    { from: "rejected", kind: "archive", to: "archived" },
  ];

  /**
   * Applies a CR transition, returning the new status.
   * Throws if the transition is invalid.
   */
  apply(from: CRStatus, kind: CRTransitionKind): CRStatus {
    const rule = this.rules.find((r) => r.from === from && r.kind === kind);
    if (!rule) {
      throw new Error(
        `Invalid CR transition: cannot apply "${kind}" from status "${from}"`,
      );
    }
    return rule.to;
  }
}
