import { validateDisplayName, type ValidationFailure } from "../shared/validation";
import type { ApiFailure } from "./api";

export type UserNameLoad =
  | { type: "loading" }
  /** `displayName` is null until the user has chosen a name. */
  | { type: "loaded"; displayName: string | null }
  | { type: "failed"; failure: ApiFailure };

/** What a form does about the name field: wait, ask for a name, already have one, or couldn't find out. */
export type NameStep = "loading" | "ask" | "known" | "failed";

export function nameStep(load: UserNameLoad): NameStep {
  if (load.type !== "loaded") {
    return load.type;
  }

  return load.displayName === null ? "ask" : "known";
}

/** Whether a form may submit: it knows whether to ask for a name. */
export function nameIsSettled(load: UserNameLoad): boolean {
  const step = nameStep(load);

  return step === "ask" || step === "known";
}

/**
 * Whether a create or join failed because the form's view of the user's name was out of date. The
 * Worker answers `bad_request` to a name sent by a user who has one, and `invalid_display_name` to
 * a user with no name who sent none; the form checks a typed name itself before sending. The form
 * then reloads the name, so the field comes back or goes away.
 */
export function nameWasStale(failure: ApiFailure): boolean {
  return (
    failure.type === "rejected" &&
    (failure.code === "bad_request" || failure.code === "invalid_display_name")
  );
}

export type NameToSend =
  | { ok: true; request: { displayName?: string } }
  | { ok: false; problem: ValidationFailure };

/**
 * What a create or join request carries for the name. The Worker refuses a name from a user who
 * already has one, so a known name sends none. Call it only once the step is `ask` or `known`.
 */
export function nameToSend(load: UserNameLoad, typed: string): NameToSend {
  if (nameStep(load) !== "ask") {
    return { ok: true, request: {} };
  }

  const checked = validateDisplayName(typed);

  return checked.ok
    ? { ok: true, request: { displayName: checked.value } }
    : { ok: false, problem: checked.reason };
}
