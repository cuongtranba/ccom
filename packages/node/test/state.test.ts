import { describe, expect, test } from "bun:test";
import type { ItemState, TransitionKind } from "@inv/shared";
import {
  StateMachine,
  CRStateMachine,
  type CRStatus,
  type CRTransitionKind,
} from "../src/state";

describe("StateMachine", () => {
  const sm = new StateMachine();

  describe("valid transitions", () => {
    test("verify: unverified -> proven", () => {
      expect(sm.apply("unverified", "verify")).toBe("proven");
    });

    test("suspect: proven -> suspect", () => {
      expect(sm.apply("proven", "suspect")).toBe("suspect");
    });

    test("re_verify: suspect -> proven", () => {
      expect(sm.apply("suspect", "re_verify")).toBe("proven");
    });

    test("break: suspect -> broke", () => {
      expect(sm.apply("suspect", "break")).toBe("broke");
    });

    test("fix: broke -> proven", () => {
      expect(sm.apply("broke", "fix")).toBe("proven");
    });
  });

  describe("invalid transitions throw", () => {
    test("cannot verify from proven", () => {
      expect(() => sm.apply("proven", "verify")).toThrow();
    });

    test("cannot suspect from unverified", () => {
      expect(() => sm.apply("unverified", "suspect")).toThrow();
    });

    test("cannot re_verify from unverified", () => {
      expect(() => sm.apply("unverified", "re_verify")).toThrow();
    });

    test("cannot break from proven", () => {
      expect(() => sm.apply("proven", "break")).toThrow();
    });

    test("cannot fix from proven", () => {
      expect(() => sm.apply("proven", "fix")).toThrow();
    });

    test("cannot break from unverified", () => {
      expect(() => sm.apply("unverified", "break")).toThrow();
    });

    test("cannot fix from suspect", () => {
      expect(() => sm.apply("suspect", "fix")).toThrow();
    });

    test("cannot verify from broke", () => {
      expect(() => sm.apply("broke", "verify")).toThrow();
    });
  });

  describe("canTransition", () => {
    test("returns true for valid transition", () => {
      expect(sm.canTransition("unverified", "verify")).toBe(true);
    });

    test("returns true for suspect -> re_verify", () => {
      expect(sm.canTransition("suspect", "re_verify")).toBe(true);
    });

    test("returns true for suspect -> break", () => {
      expect(sm.canTransition("suspect", "break")).toBe(true);
    });

    test("returns true for broke -> fix", () => {
      expect(sm.canTransition("broke", "fix")).toBe(true);
    });

    test("returns false for invalid transition", () => {
      expect(sm.canTransition("proven", "verify")).toBe(false);
    });

    test("returns false for unverified -> fix", () => {
      expect(sm.canTransition("unverified", "fix")).toBe(false);
    });

    test("returns false for broke -> suspect", () => {
      expect(sm.canTransition("broke", "suspect")).toBe(false);
    });
  });

  describe("availableTransitions", () => {
    test("unverified has only verify", () => {
      expect(sm.availableTransitions("unverified")).toEqual(["verify"]);
    });

    test("proven has only suspect", () => {
      expect(sm.availableTransitions("proven")).toEqual(["suspect"]);
    });

    test("suspect has re_verify and break", () => {
      const transitions = sm.availableTransitions("suspect");
      expect(transitions).toContain("re_verify");
      expect(transitions).toContain("break");
      expect(transitions).toHaveLength(2);
    });

    test("broke has only fix", () => {
      expect(sm.availableTransitions("broke")).toEqual(["fix"]);
    });
  });
});

describe("CRStateMachine", () => {
  const cr = new CRStateMachine();

  describe("valid transitions", () => {
    test("submit: draft -> proposed", () => {
      expect(cr.apply("draft", "submit")).toBe("proposed");
    });

    test("open_voting: proposed -> voting", () => {
      expect(cr.apply("proposed", "open_voting")).toBe("voting");
    });

    test("approve: voting -> approved", () => {
      expect(cr.apply("voting", "approve")).toBe("approved");
    });

    test("reject: voting -> rejected", () => {
      expect(cr.apply("voting", "reject")).toBe("rejected");
    });

    test("apply: approved -> applied", () => {
      expect(cr.apply("approved", "apply")).toBe("applied");
    });

    test("archive from applied: applied -> archived", () => {
      expect(cr.apply("applied", "archive")).toBe("archived");
    });

    test("archive from rejected: rejected -> archived", () => {
      expect(cr.apply("rejected", "archive")).toBe("archived");
    });
  });

  describe("invalid transitions throw", () => {
    test("cannot submit from proposed", () => {
      expect(() => cr.apply("proposed", "submit")).toThrow();
    });

    test("cannot open_voting from draft", () => {
      expect(() => cr.apply("draft", "open_voting")).toThrow();
    });

    test("cannot approve from proposed", () => {
      expect(() => cr.apply("proposed", "approve")).toThrow();
    });

    test("cannot reject from proposed", () => {
      expect(() => cr.apply("proposed", "reject")).toThrow();
    });

    test("cannot apply from voting", () => {
      expect(() => cr.apply("voting", "apply")).toThrow();
    });

    test("cannot archive from draft", () => {
      expect(() => cr.apply("draft", "archive")).toThrow();
    });

    test("cannot archive from proposed", () => {
      expect(() => cr.apply("proposed", "archive")).toThrow();
    });

    test("cannot archive from voting", () => {
      expect(() => cr.apply("voting", "archive")).toThrow();
    });

    test("cannot archive from approved", () => {
      // approved can only go to applied, not archived
      expect(() => cr.apply("approved", "archive")).toThrow();
    });

    test("cannot apply from rejected", () => {
      expect(() => cr.apply("rejected", "apply")).toThrow();
    });

    test("cannot submit from archived", () => {
      expect(() => cr.apply("archived", "submit")).toThrow();
    });
  });
});
