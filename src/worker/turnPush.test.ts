import { describe, expect, it } from "vitest";

import {
  afterContribution,
  newStoryState,
  onJoin,
  onLeave,
  onRejoin,
  skip,
  type TurnResult,
  type TurnState,
} from "../shared/turnOrder";
import { TURN_WINDOW_MS } from "../shared/validation";
import type { ParticipantRow } from "./db/rows";
import type { LoadedStory } from "./db/typeSchemas";
import { requesterPositionInSavedOrder, turnPassedToSomeoneOtherThanRequester } from "./turnPush";

const T0 = 1_700_000_000_000;
const ANA = 0;
const BEN = 1;
const CY = 2;
const DAN = 3;

// Ana wrote the opening, Ben holds the turn from T0 and Cy is next.
function benHolds(): TurnState {
  return onJoin(onJoin(newStoryState(), BEN, T0), CY, T0);
}

// Ana wrote last and is alone: Ben joined, then left.
function waitingWithAna(): TurnState {
  return onLeave(onJoin(newStoryState(), BEN, T0), BEN, T0);
}

function participant(position: number, leftAt: number | null = null): ParticipantRow {
  return {
    id: `p${String(position)}`,
    displayName: `Writer ${String(position)}`,
    position,
    userId: `u${String(position)}`,
    leftAt,
  };
}

// The story as a request loads it. `rows` are everyone who ever joined, a leaver included.
function loadedAs(state: TurnState, rows: readonly ParticipantRow[]): LoadedStory {
  return {
    story: { id: "abc12", createdAt: T0, ...state },
    participants: [...rows],
    activeParticipants: rows.filter((row) => row.leftAt === null),
    nextPosition: Math.max(...rows.map((row) => row.position)) + 1,
    state,
  };
}

function unwrap(result: TurnResult): TurnState {
  if (!result.ok) {
    throw new Error(`Expected the write to succeed, got ${result.reason}`);
  }

  return result.state;
}

describe("turnPassedToSomeoneOtherThanRequester", () => {
  it("returns the position of the writer a contribution passes the turn to", () => {
    const stored = benHolds();
    const saved = unwrap(
      afterContribution(stored, T0, { contributorPosition: BEN, turnVersion: stored.turnVersion }),
    );

    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, BEN, T0)).toBe(CY);
  });

  it("returns null when the same person keeps the turn through a join", () => {
    const stored = benHolds();
    const saved = onJoin(stored, DAN, T0);

    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, DAN, T0)).toBeNull();
  });

  it("returns null when the story goes to waiting, so no one is pushed for a turn that is not there", () => {
    const stored = onJoin(newStoryState(), BEN, T0);
    const saved = onLeave(stored, BEN, T0);

    expect(saved.currentPosition).toBeNull();
    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, ANA, T0)).toBeNull();
  });

  // Without the exclusion the requester would be pushed for a turn they just took themselves.
  it.each([
    {
      name: "a joiner who starts a waiting story",
      stored: waitingWithAna(),
      saved: onJoin(waitingWithAna(), CY, T0),
      requester: CY,
    },
    {
      name: "a rejoiner who takes a waiting story",
      stored: waitingWithAna(),
      saved: onRejoin(waitingWithAna(), { previousPosition: BEN, position: CY }, T0),
      requester: CY,
    },
    {
      name: "a skipper who takes the turn",
      stored: benHolds(),
      saved: unwrap(
        skip(benHolds(), T0, { skipperPosition: CY, turnVersion: benHolds().turnVersion }),
      ),
      requester: CY,
    },
  ])("returns null for $name, and their position for any other requester", (scenario) => {
    const { stored, saved, requester } = scenario;

    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, requester, T0)).toBeNull();
    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, ANA, T0)).toBe(requester);
  });

  // Without expiry first, the stored holder (Ben) differs from the saved one (Cy), so the join
  // would look like a hand-over to Cy.
  it("applies expiry to the stored turn first, so a lapsed holder's successor is not pushed for an unrelated change", () => {
    const stored = benHolds();
    const now = T0 + TURN_WINDOW_MS + 1000;
    const saved = onJoin(stored, DAN, now);

    expect(saved.currentPosition).toBe(CY);
    expect(turnPassedToSomeoneOtherThanRequester(stored, saved, DAN, now)).toBeNull();
  });
});

describe("requesterPositionInSavedOrder", () => {
  const rows = [participant(ANA), participant(BEN), participant(CY)];

  // Ben left and Cy holds; Ben keeps his row at the old position until he rejoins.
  const afterBenLeft = onLeave(benHolds(), BEN, T0);
  const rowsAfterBenLeft = [participant(ANA), participant(BEN, T0), participant(CY)];

  it.each([
    {
      name: "a join takes the new position at the end",
      loaded: loadedAs(benHolds(), rows),
      saved: onJoin(benHolds(), DAN, T0),
      requester: "u-new",
      expected: DAN,
    },
    {
      name: "a rejoin takes the new position, not the one on the requester's old row",
      loaded: loadedAs(afterBenLeft, rowsAfterBenLeft),
      saved: onRejoin(afterBenLeft, { previousPosition: BEN, position: DAN }, T0),
      requester: "u1",
      expected: DAN,
    },
    {
      name: "a passage keeps the holder where they were loaded",
      loaded: loadedAs(benHolds(), rows),
      saved: unwrap(
        afterContribution(benHolds(), T0, {
          contributorPosition: BEN,
          turnVersion: benHolds().turnVersion,
        }),
      ),
      requester: "u1",
      expected: BEN,
    },
    {
      name: "a skip keeps the skipper where they were loaded",
      loaded: loadedAs(benHolds(), rows),
      saved: unwrap(
        skip(benHolds(), T0, { skipperPosition: CY, turnVersion: benHolds().turnVersion }),
      ),
      requester: "u2",
      expected: CY,
    },
    {
      name: "a leave keeps the leaver at the position they held",
      loaded: loadedAs(benHolds(), rows),
      saved: onLeave(benHolds(), BEN, T0),
      requester: "u1",
      expected: BEN,
    },
  ])("returns the position for $name", ({ loaded, saved, requester, expected }) => {
    expect(requesterPositionInSavedOrder(loaded, saved, requester)).toBe(expected);
  });

  it("throws for a user who is neither new to the turn order nor already in the story", () => {
    const stored = benHolds();

    expect(() =>
      requesterPositionInSavedOrder(loadedAs(stored, rows), stored, "u-stranger"),
    ).toThrow("not a participant");
  });
});
