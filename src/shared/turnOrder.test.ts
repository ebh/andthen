import { describe, expect, it } from "vitest";

import {
  afterContribution,
  canSkip,
  newStoryState,
  onJoin,
  onLeave,
  onRejoin,
  resolveTurn,
  skip,
  type TurnState,
  turnEndsAt,
  turnPassedTo,
} from "./turnOrder";
import { TURN_WINDOW_MS as WINDOW } from "./validation";

const T0 = 1_700_000_000_000;
const A = 0;
const B = 1;
const C = 2;

interface InTurnOverrides {
  currentPosition?: number;
  lastContributorPosition?: number | null;
  participantPositions?: readonly number[];
}

// By default A, B and C are in turn order, A wrote last and B holds the turn from T0 at version 5.
function bHolds(overrides: InTurnOverrides = {}): TurnState {
  return {
    turnVersion: 5,
    lastContributorPosition: A,
    participantPositions: [A, B, C],
    currentPosition: B,
    turnStartedAt: T0,
    ...overrides,
  };
}

function waiting(): TurnState {
  return {
    turnVersion: 3,
    lastContributorPosition: A,
    participantPositions: [A],
    currentPosition: null,
    turnStartedAt: null,
  };
}

describe("newStoryState", () => {
  it("has the creator alone, as last contributor, waiting at version 0", () => {
    expect(newStoryState()).toEqual({
      turnVersion: 0,
      lastContributorPosition: 0,
      participantPositions: [0],
      currentPosition: null,
      turnStartedAt: null,
    });
  });
});

describe("turnEndsAt", () => {
  it("is one window after the turn started", () => {
    expect(turnEndsAt(bHolds())).toBe(T0 + WINDOW);
  });

  it("is null while the story waits", () => {
    expect(turnEndsAt(waiting())).toBeNull();
  });
});

describe("resolveTurn", () => {
  it("leaves the turn alone one millisecond before it ends", () => {
    const state = bHolds();
    expect(resolveTurn(state, T0 + WINDOW - 1)).toEqual({ state, changed: false });
  });

  it("leaves the turn alone at the moment it starts", () => {
    const state = bHolds();
    expect(resolveTurn(state, T0)).toEqual({ state, changed: false });
  });

  // A clock behind the stored start must not move the turn backwards or lower the version.
  it("leaves the turn alone when now is before the turn started", () => {
    const state = bHolds();
    expect(resolveTurn(state, T0 - WINDOW - 1)).toEqual({ state, changed: false });
  });

  it("expires the turn at exactly its end", () => {
    expect(resolveTurn(bHolds(), T0 + WINDOW)).toEqual({
      state: { ...bHolds(), currentPosition: C, turnStartedAt: T0 + WINDOW, turnVersion: 6 },
      changed: true,
    });
  });

  it("keeps the new turn's start on the window boundary, not at now", () => {
    expect(resolveTurn(bHolds(), T0 + WINDOW + 123).state.turnStartedAt).toBe(T0 + WINDOW);
  });

  // B, then C, then (passing over A, who wrote last) B again.
  it.each([
    [1, C],
    [2, B],
    [3, C],
    [4, B],
  ])(
    "moves on one place for each of %i elapsed windows, passing over the last contributor",
    (windows, holder) => {
      expect(resolveTurn(bHolds(), T0 + windows * WINDOW)).toEqual({
        state: {
          ...bHolds(),
          currentPosition: holder,
          turnStartedAt: T0 + windows * WINDOW,
          turnVersion: 5 + windows,
        },
        changed: true,
      });
    },
  );

  it("wraps around the turn order to the lowest position", () => {
    const cHolds = bHolds({ currentPosition: C, lastContributorPosition: B });
    expect(resolveTurn(cHolds, T0 + WINDOW).state.currentPosition).toBe(A);
  });

  it("follows position order, not array order, and allows gaps", () => {
    const holds3 = bHolds({
      currentPosition: 3,
      lastContributorPosition: null,
      participantPositions: [7, 3, 1],
    });
    expect(resolveTurn(holds3, T0 + WINDOW).state.currentPosition).toBe(7);
    expect(resolveTurn(holds3, T0 + 2 * WINDOW).state.currentPosition).toBe(1);
  });

  it("renews the only eligible holder each window in a two-person story", () => {
    const state = bHolds({ participantPositions: [A, B] });
    expect(resolveTurn(state, T0 + 2 * WINDOW).state).toEqual({
      ...state,
      turnStartedAt: T0 + 2 * WINDOW,
      turnVersion: 7,
    });
  });

  it("never times out a waiting story", () => {
    const state = waiting();
    expect(resolveTurn(state, T0 + 100 * WINDOW)).toEqual({ state, changed: false });
  });

  // Pins that a writer persisting an early resolution never disagrees with a later fresh read.
  it("gives the same state resolving in two steps as in one", () => {
    const now = T0 + 5 * WINDOW + 17;
    const early = resolveTurn(bHolds(), T0 + 2 * WINDOW + 3).state;
    expect(resolveTurn(early, now).state).toEqual(resolveTurn(bHolds(), now).state);
  });
});

describe("afterContribution", () => {
  it("passes the turn to the next person and starts their window now", () => {
    const now = T0 + 1000;
    expect(afterContribution(bHolds(), now, { contributorPosition: B, turnVersion: 5 })).toEqual({
      ok: true,
      state: {
        ...bHolds(),
        lastContributorPosition: B,
        currentPosition: C,
        turnStartedAt: now,
        turnVersion: 6,
      },
    });
  });

  it("wraps around to the lowest position", () => {
    const cHolds = bHolds({ currentPosition: C, lastContributorPosition: B });
    expect(afterContribution(cHolds, T0 + 7, { contributorPosition: C, turnVersion: 5 })).toEqual({
      ok: true,
      state: {
        ...cHolds,
        currentPosition: A,
        lastContributorPosition: C,
        turnStartedAt: T0 + 7,
        turnVersion: 6,
      },
    });
  });

  it("follows position order, not array order, across gaps", () => {
    const holds3 = bHolds({
      currentPosition: 3,
      lastContributorPosition: 1,
      participantPositions: [7, 3, 1],
    });
    expect(afterContribution(holds3, T0, { contributorPosition: 3, turnVersion: 5 })).toEqual({
      ok: true,
      state: {
        ...holds3,
        currentPosition: 7,
        lastContributorPosition: 3,
        turnStartedAt: T0,
        turnVersion: 6,
      },
    });
  });

  it("makes a solo writer's story wait, with no timer", () => {
    const solo: TurnState = {
      turnVersion: 4,
      lastContributorPosition: null,
      participantPositions: [A],
      currentPosition: A,
      turnStartedAt: T0,
    };
    expect(afterContribution(solo, T0 + 1, { contributorPosition: A, turnVersion: 4 })).toEqual({
      ok: true,
      state: {
        ...solo,
        lastContributorPosition: A,
        currentPosition: null,
        turnStartedAt: null,
        turnVersion: 5,
      },
    });
  });

  it("rejects a stale version", () => {
    expect(afterContribution(bHolds(), T0, { contributorPosition: B, turnVersion: 4 })).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  it("rejects someone who is not the holder", () => {
    expect(afterContribution(bHolds(), T0, { contributorPosition: C, turnVersion: 5 })).toEqual({
      ok: false,
      reason: "not_your_turn",
    });
  });

  it("rejects anyone while the story waits", () => {
    expect(afterContribution(waiting(), T0, { contributorPosition: A, turnVersion: 3 })).toEqual({
      ok: false,
      reason: "not_your_turn",
    });
  });

  it("rejects the holder once their turn has expired, as stale", () => {
    expect(
      afterContribution(bHolds(), T0 + WINDOW, { contributorPosition: B, turnVersion: 5 }),
    ).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  // Three windows: B, then C, then B again (A wrote last). The page showed version 5 + 3.
  it("accepts the holder after several expired windows, at the loaded version plus windows", () => {
    const now = T0 + 3 * WINDOW + 10;
    expect(afterContribution(bHolds(), now, { contributorPosition: C, turnVersion: 8 })).toEqual({
      ok: true,
      state: {
        ...bHolds(),
        lastContributorPosition: C,
        currentPosition: A,
        turnStartedAt: now,
        turnVersion: 9,
      },
    });
    expect(afterContribution(bHolds(), now, { contributorPosition: C, turnVersion: 7 })).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  it("accepts the new holder after expiry, at the resolved version", () => {
    const now = T0 + WINDOW + 10;
    expect(afterContribution(bHolds(), now, { contributorPosition: C, turnVersion: 6 })).toEqual({
      ok: true,
      state: {
        ...bHolds(),
        lastContributorPosition: C,
        currentPosition: A,
        turnStartedAt: now,
        turnVersion: 7,
      },
    });
  });
});

describe("skip", () => {
  it("passes the turn to the next person and starts their window now", () => {
    const now = T0 + 1000;
    expect(skip(bHolds(), now, { skipperPosition: A, turnVersion: 5 })).toEqual({
      ok: true,
      state: { ...bHolds(), currentPosition: C, turnStartedAt: now, turnVersion: 6 },
    });
  });

  it("passes over the last contributor", () => {
    const cHolds = bHolds({ currentPosition: C });
    expect(skip(cHolds, T0 + 7, { skipperPosition: B, turnVersion: 5 })).toEqual({
      ok: true,
      state: { ...cHolds, currentPosition: B, turnStartedAt: T0 + 7, turnVersion: 6 },
    });
  });

  // Turn order 1, 3, 7, 9 given out of order; 3 wrote last.
  it.each([
    [7, 9],
    [9, 1],
    [1, 7],
  ])("follows position order across gaps: %i is skipped to %i", (holder, next) => {
    const state = bHolds({
      currentPosition: holder,
      lastContributorPosition: 3,
      participantPositions: [7, 3, 1, 9],
    });
    expect(skip(state, T0, { skipperPosition: 3, turnVersion: 5 })).toEqual({
      ok: true,
      state: { ...state, currentPosition: next, turnStartedAt: T0, turnVersion: 6 },
    });
  });

  // Two windows: B, then C, then B. The page showed version 5 + 2.
  it("skips after several expired windows, at the loaded version plus windows", () => {
    const now = T0 + 2 * WINDOW + 5;
    expect(skip(bHolds(), now, { skipperPosition: C, turnVersion: 7 })).toEqual({
      ok: true,
      state: { ...bHolds(), currentPosition: C, turnStartedAt: now, turnVersion: 8 },
    });
  });

  // docs/turn-persistence.md: the caller checks the client's version against the resolved one,
  // but guards the write with the version it loaded. The two differ by the windows elapsed.
  it("returns a state ahead of the loaded version by the windows elapsed plus one", () => {
    const loaded = bHolds();
    const result = skip(loaded, T0 + 2 * WINDOW, { skipperPosition: C, turnVersion: 7 });
    expect(loaded.turnVersion).toBe(5);
    expect(result).toMatchObject({ ok: true, state: { turnVersion: 5 + 2 + 1 } });
  });

  it("rejects the holder skipping themselves", () => {
    expect(skip(bHolds(), T0, { skipperPosition: B, turnVersion: 5 })).toEqual({
      ok: false,
      reason: "cannot_skip_self",
    });
  });

  it("rejects a stale version", () => {
    expect(skip(bHolds(), T0, { skipperPosition: A, turnVersion: 6 })).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  it("rejects a skip of a turn that has already expired", () => {
    expect(skip(bHolds(), T0 + WINDOW, { skipperPosition: A, turnVersion: 5 })).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  it("skips the resolved holder after expiry", () => {
    const now = T0 + WINDOW;
    expect(skip(bHolds(), now, { skipperPosition: A, turnVersion: 6 })).toEqual({
      ok: true,
      state: { ...bHolds(), currentPosition: B, turnStartedAt: now, turnVersion: 7 },
    });
  });

  // There is no holder to skip; stale_turn makes the page refetch and drop its skip button.
  it("rejects a skip while the story waits as stale", () => {
    expect(skip(waiting(), T0, { skipperPosition: A, turnVersion: 3 })).toEqual({
      ok: false,
      reason: "stale_turn",
    });
  });

  // A wrote last, so the turn would come straight back to B with a fresh window.
  it("rejects a skip in a two-person story where the skipper wrote last", () => {
    expect(
      skip(bHolds({ participantPositions: [A, B] }), T0, { skipperPosition: A, turnVersion: 5 }),
    ).toEqual({
      ok: false,
      reason: "no_one_to_skip_to",
    });
  });
});

describe("onJoin", () => {
  it("lets the first joiner of a waiting story take the turn and starts the timer", () => {
    const now = T0 + 42;
    expect(onJoin(waiting(), 1, now)).toEqual({
      ...waiting(),
      participantPositions: [A, 1],
      currentPosition: 1,
      turnStartedAt: now,
      turnVersion: 4,
    });
  });

  // An action that loaded the turn order before the join must fail the storage guard.
  it("adds the joiner at the given position, keeps the holder and bumps the version", () => {
    expect(onJoin(bHolds(), 3, T0 + 1)).toEqual({
      ...bHolds(),
      participantPositions: [A, B, C, 3],
      turnVersion: 6,
    });
  });

  it("applies expiry before the joiner arrives", () => {
    expect(onJoin(bHolds(), 3, T0 + WINDOW)).toMatchObject({
      currentPosition: C,
      turnStartedAt: T0 + WINDOW,
      turnVersion: 7,
      participantPositions: [A, B, C, 3],
    });
  });

  it("starts a new story's first turn with the first joiner", () => {
    expect(onJoin(newStoryState(), 1, T0)).toEqual({
      turnVersion: 1,
      lastContributorPosition: 0,
      participantPositions: [0, 1],
      currentPosition: 1,
      turnStartedAt: T0,
    });
  });
});

describe("onRejoin", () => {
  it("adds the rejoiner at their new position and leaves the last contributor alone", () => {
    const state = bHolds({ participantPositions: [A, C], currentPosition: C });

    expect(onRejoin(state, { previousPosition: B, position: 3 }, T0 + 1)).toEqual({
      ...state,
      participantPositions: [A, C, 3],
      turnVersion: 6,
    });
  });

  it("keeps someone who wrote last as the last contributor under their new position", () => {
    const state = bHolds({ participantPositions: [B, C], lastContributorPosition: A });

    expect(onRejoin(state, { previousPosition: A, position: 3 }, T0 + 1)).toMatchObject({
      lastContributorPosition: 3,
      participantPositions: [B, C, 3],
      currentPosition: B,
    });
  });

  it("keeps a story waiting when the one who comes back wrote last", () => {
    const empty: TurnState = { ...waiting(), participantPositions: [] };

    expect(onRejoin(empty, { previousPosition: A, position: 1 }, T0)).toEqual({
      turnVersion: 4,
      lastContributorPosition: 1,
      participantPositions: [1],
      currentPosition: null,
      turnStartedAt: null,
    });
  });

  it("gives the turn to a rejoiner who did not write last when the story waits", () => {
    const empty: TurnState = { ...waiting(), participantPositions: [] };

    expect(onRejoin(empty, { previousPosition: B, position: 3 }, T0)).toEqual({
      turnVersion: 4,
      lastContributorPosition: A,
      participantPositions: [3],
      currentPosition: 3,
      turnStartedAt: T0,
    });
  });

  it("applies expiry before the rejoiner arrives", () => {
    expect(onRejoin(bHolds(), { previousPosition: 9, position: 3 }, T0 + WINDOW)).toMatchObject({
      currentPosition: C,
      turnStartedAt: T0 + WINDOW,
      turnVersion: 7,
    });
  });
});

describe("onLeave", () => {
  it("takes a writer who does not hold the turn out of the turn order and bumps the version", () => {
    expect(onLeave(bHolds(), C, T0 + 1)).toEqual({
      ...bHolds(),
      participantPositions: [A, B],
      turnVersion: 6,
    });
  });

  it("passes the turn to the next writer, with a fresh window, when the holder leaves", () => {
    expect(onLeave(bHolds(), B, T0 + 1000)).toEqual({
      ...bHolds(),
      participantPositions: [A, C],
      currentPosition: C,
      turnStartedAt: T0 + 1000,
      turnVersion: 6,
    });
  });

  it("passes over the last contributor when the holder leaves", () => {
    // C holds and leaves; the next place after C wraps to A, who wrote last, so B gets the turn.
    expect(onLeave(bHolds({ currentPosition: C }), C, T0 + 1)).toMatchObject({
      participantPositions: [A, B],
      currentPosition: B,
    });
  });

  it("gives the turn to the one writer left when they did not write last", () => {
    const state = bHolds({ participantPositions: [B, C] });

    expect(onLeave(state, B, T0 + 1)).toMatchObject({
      participantPositions: [C],
      currentPosition: C,
      turnStartedAt: T0 + 1,
    });
  });

  it("makes the story wait when the holder leaves and the one left wrote last", () => {
    expect(onLeave(bHolds({ participantPositions: [A, B] }), B, T0 + 1)).toEqual({
      ...bHolds(),
      participantPositions: [A],
      currentPosition: null,
      turnStartedAt: null,
      turnVersion: 6,
    });
  });

  it("makes the story wait when the holder was the only writer", () => {
    expect(onLeave(bHolds({ participantPositions: [B] }), B, T0 + 1)).toMatchObject({
      participantPositions: [],
      currentPosition: null,
      turnStartedAt: null,
    });
  });

  it("keeps a waiting story waiting when its only writer leaves", () => {
    expect(onLeave(waiting(), A, T0)).toEqual({
      ...waiting(),
      participantPositions: [],
      turnVersion: 4,
    });
  });

  it("applies expiry first, so a holder whose turn just ended leaves as a non-holder", () => {
    // B's window ends at T0 + WINDOW and the turn moves to C, who is not the leaver.
    expect(onLeave(bHolds(), B, T0 + WINDOW)).toMatchObject({
      participantPositions: [A, C],
      currentPosition: C,
      turnStartedAt: T0 + WINDOW,
      turnVersion: 7,
    });
  });

  it("applies expiry first, so the holder of the moved-on turn passes it on", () => {
    // The turn moves from B to C at T0 + WINDOW; C leaves and the next place after C is B.
    expect(onLeave(bHolds(), C, T0 + WINDOW)).toMatchObject({
      participantPositions: [A, B],
      currentPosition: B,
      turnStartedAt: T0 + WINDOW,
      turnVersion: 7,
    });
  });
});

describe("canSkip", () => {
  it("is true in a 3-person story, including when the last writer is the next candidate", () => {
    // C holds, A wrote last: the next candidate after C is A, who is passed over for B.
    expect(canSkip(bHolds({ currentPosition: C }))).toBe(true);
    // A holds, B wrote last: the next candidate after A is B, who is passed over for C.
    expect(canSkip(bHolds({ currentPosition: A, lastContributorPosition: B }))).toBe(true);
    // B holds, A wrote last: C is next and eligible.
    expect(canSkip(bHolds())).toBe(true);
  });

  it("is false with two people, where the turn would return to the holder", () => {
    expect(canSkip(bHolds({ participantPositions: [A, B] }))).toBe(false);
  });

  it("is false while the story waits", () => {
    expect(canSkip(waiting())).toBe(false);
  });

  it("matches skip: no_one_to_skip_to exactly when canSkip is false", () => {
    const twoPeople = bHolds({ participantPositions: [A, B] });

    expect(skip(twoPeople, T0, { skipperPosition: A, turnVersion: 5 })).toEqual({
      ok: false,
      reason: "no_one_to_skip_to",
    });
  });
});

describe("turnPassedTo", () => {
  it("names the new holder when the turn moves to another person", () => {
    const result = afterContribution(bHolds(), T0 + 1, { contributorPosition: B, turnVersion: 5 });

    expect(result.ok && turnPassedTo(bHolds(), result.state)).toBe(C);
  });

  it("is null when the same person keeps the turn", () => {
    const joined = onJoin(bHolds(), 3, T0 + 1);

    expect(turnPassedTo(bHolds(), joined)).toBeNull();
  });

  it("is null when the story goes to waiting", () => {
    const alone = bHolds({ participantPositions: [B] });
    const result = afterContribution(alone, T0 + 1, { contributorPosition: B, turnVersion: 5 });

    expect(result.ok && result.state.currentPosition).toBeNull();
    expect(result.ok && turnPassedTo(alone, result.state)).toBeNull();
  });

  it("names the joiner who starts a waiting story", () => {
    expect(turnPassedTo(waiting(), onJoin(waiting(), 1, T0))).toBe(1);
  });

  it("is null for a waiting story that stays waiting", () => {
    expect(
      turnPassedTo(waiting(), onJoin({ ...waiting(), lastContributorPosition: 1 }, 1, T0)),
    ).toBeNull();
  });
});
