/**
 * Whose turn it is, worked out from a story's stored state and the current time.
 *
 * Rules every caller relies on:
 * - The rotation is participants in ascending `position` order, wrapping around.
 * - Nobody takes two turns in a row: the turn passes over the last contributor. A story whose
 *   only participant is the last contributor waits, with no timer, until someone joins. In a
 *   two-person story the other person keeps the turn, a fresh window at a time, until they write.
 * - Turns expire lazily. Each whole TURN_WINDOW_MS that passes moves the turn on one place.
 *
 * `turnVersion` identifies one holder for one window over one rotation. It goes up by exactly one
 * for each contribution, skip, expired window and join. A join must bump it even when the turn
 * stays put: an action that loaded the old rotation would otherwise pass the storage guard and
 * hand the turn to the wrong person.
 *
 * Every action takes the state as loaded from storage and resolves expiry itself.
 * docs/turn-persistence.md says how to persist the result.
 */
import { TURN_WINDOW_MS } from "./validation";

/** Mirrors the `stories` row plus its participants' positions. */
export type TurnState = {
  turnVersion: number;
  lastContributorPosition: number | null;
  participantPositions: readonly number[];
} & (
  | { currentPosition: null; turnStartedAt: null } // waiting for a joiner
  | { currentPosition: number; turnStartedAt: number }
);

export type TurnResult = { ok: true; state: TurnState } | { ok: false; reason: TurnRejection };

export type TurnRejection =
  | "stale_turn"
  | "not_your_turn"
  | "cannot_skip_self"
  | "no_one_to_skip_to";

export interface ResolvedTurn {
  state: TurnState;
  /** True when expiry moved the turn, so a writer must persist `state`. */
  changed: boolean;
}

export interface ContributeAction {
  contributorPosition: number;
  turnVersion: number;
}

export interface SkipAction {
  skipperPosition: number;
  turnVersion: number;
}

export interface JoinAction {
  state: TurnState;
  joinerPosition: number;
}

const CREATOR_POSITION = 0;

/** A new story after its creator's opening passage: the creator alone, waiting for a joiner. */
export function newStoryState(): TurnState {
  return {
    turnVersion: 0,
    lastContributorPosition: CREATOR_POSITION,
    participantPositions: [CREATOR_POSITION],
    currentPosition: null,
    turnStartedAt: null,
  };
}

/** Applies every turn window that has fully elapsed by `now`. A turn expires at exactly its end. */
export function resolveTurn(state: TurnState, now: number): ResolvedTurn {
  if (state.currentPosition === null) {
    return { state, changed: false };
  }

  const windowsElapsed = Math.floor((now - state.turnStartedAt) / TURN_WINDOW_MS);
  if (windowsElapsed <= 0) {
    return { state, changed: false };
  }

  let position = state.currentPosition;
  for (let window = 0; window < windowsElapsed; window += 1) {
    position = nextHolder(state, position);
  }

  return {
    state: {
      ...state,
      currentPosition: position,
      turnStartedAt: state.turnStartedAt + windowsElapsed * TURN_WINDOW_MS,
      turnVersion: state.turnVersion + windowsElapsed,
    },
    changed: true,
  };
}

/** When the current turn expires, or null while the story waits. */
export function turnEndsAt(state: TurnState): number | null {
  return state.turnStartedAt === null ? null : state.turnStartedAt + TURN_WINDOW_MS;
}

/**
 * Passes the turn on after the holder writes. The writer becomes the last contributor; if they
 * are the only participant, the story waits.
 */
export function afterContribution(
  state: TurnState,
  now: number,
  contribution: ContributeAction,
): TurnResult {
  const current = resolveTurn(state, now).state;

  if (contribution.turnVersion !== current.turnVersion) {
    return { ok: false, reason: "stale_turn" };
  }
  if (contribution.contributorPosition !== current.currentPosition) {
    return { ok: false, reason: "not_your_turn" };
  }

  const written = { ...current, lastContributorPosition: contribution.contributorPosition };
  const next = nextHolder(written, contribution.contributorPosition);
  const turnVersion = current.turnVersion + 1;

  if (next === contribution.contributorPosition) {
    return {
      ok: true,
      state: { ...written, turnVersion, currentPosition: null, turnStartedAt: null },
    };
  }
  return {
    ok: true,
    state: { ...written, turnVersion, currentPosition: next, turnStartedAt: now },
  };
}

/**
 * Passes the turn from its holder to the next person. Anyone but the holder may skip.
 *
 * Skipping a story that waits answers `stale_turn`: the page showed a turn that is gone.
 * When the only other person is the last contributor, the turn would come straight back to the
 * holder with a fresh window, so the skip is refused with `no_one_to_skip_to`.
 */
export function skip(state: TurnState, now: number, request: SkipAction): TurnResult {
  const current = resolveTurn(state, now).state;

  if (request.turnVersion !== current.turnVersion || current.currentPosition === null) {
    return { ok: false, reason: "stale_turn" };
  }
  if (request.skipperPosition === current.currentPosition) {
    return { ok: false, reason: "cannot_skip_self" };
  }

  const next = nextHolder(current, current.currentPosition);
  if (next === current.currentPosition) {
    return { ok: false, reason: "no_one_to_skip_to" };
  }

  return {
    ok: true,
    state: {
      ...current,
      turnVersion: current.turnVersion + 1,
      currentPosition: next,
      turnStartedAt: now,
    },
  };
}

/**
 * Adds a joiner at the end of the rotation. A joiner to a waiting story takes the turn. Either
 * way the version goes up by exactly one.
 */
export function onJoin(state: TurnState, now: number): JoinAction {
  const current = resolveTurn(state, now).state;
  const joinerPosition = Math.max(...current.participantPositions) + 1;
  const joined = {
    ...current,
    turnVersion: current.turnVersion + 1,
    participantPositions: [...current.participantPositions, joinerPosition],
  };

  if (joined.currentPosition !== null) {
    return { state: joined, joinerPosition };
  }
  return {
    state: { ...joined, currentPosition: joinerPosition, turnStartedAt: now },
    joinerPosition,
  };
}

// The next position in the rotation after `from`, passing over the last contributor. Returns
// `from` itself when nobody else is eligible.
function nextHolder(state: TurnState, from: number): number {
  const candidate = following(state.participantPositions, from);
  return candidate === state.lastContributorPosition
    ? following(state.participantPositions, candidate)
    : candidate;
}

function following(positions: readonly number[], from: number): number {
  const later = positions.filter((position) => position > from);
  return Math.min(...(later.length > 0 ? later : positions));
}
