import { describe, expect, it } from "vitest";

import { TURN_WINDOW_MS } from "../shared/validation";
import type { ParticipantRow } from "./db/rows";
import type { LoadedStory } from "./db/storyRepo";
import { buildStoryView } from "./storyView";

const ana: ParticipantRow = {
  id: "p0",
  displayName: "Ana",
  displayNameKey: "ana",
  position: 0,
  browserTokenHash: "h0",
};

const waiting: LoadedStory = {
  story: {
    id: "abc12",
    createdAt: 0,
    turnVersion: 0,
    lastContributorPosition: 0,
    currentPosition: null,
    turnStartedAt: null,
  },
  participants: [ana],
  state: {
    turnVersion: 0,
    lastContributorPosition: 0,
    participantPositions: [0],
    currentPosition: null,
    turnStartedAt: null,
  },
};

describe("buildStoryView", () => {
  it("shows a waiting story with no holder and no end time", () => {
    expect(buildStoryView(waiting, [], ana, 5).turn).toEqual({
      holderId: null,
      endsAt: null,
      version: 0,
    });
  });

  it("names the holder and the end of the turn", () => {
    const running: LoadedStory = {
      ...waiting,
      state: { ...waiting.state, turnVersion: 1, currentPosition: 0, turnStartedAt: 100 },
    };

    const view = buildStoryView(running, [], ana, 100);

    expect(view).toEqual({
      contributions: [],
      participants: [{ id: "p0", displayName: "Ana" }],
      turn: { holderId: "p0", endsAt: 100 + TURN_WINDOW_MS, version: 1 },
      me: "p0",
    });
  });

  it("fails fast when the stored holder is not a participant", () => {
    const broken: LoadedStory = {
      ...waiting,
      state: { ...waiting.state, currentPosition: 7, turnStartedAt: 100 },
    };

    expect(() => buildStoryView(broken, [], ana, 100)).toThrow(
      "Story abc12 has no participant at position 7",
    );
  });
});
