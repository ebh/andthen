import type { PlainErrorCode } from "../shared/api";
import { MAX_DISPLAY_NAME_LENGTH, type ValidationFailure } from "../shared/validation";
import type { ApiFailure } from "./api";

/** Messages for specific error codes in one place; anything not listed gets a generic one. */
export type MessagesByCode = { [code in PlainErrorCode]?: string };

/** Plain-language text for a failed call. `byCode` holds the wording for codes this screen expects. */
export function describeFailure(failure: ApiFailure, byCode: MessagesByCode = {}): string {
  if (failure.type === "network") {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (failure.type === "rejected") {
    return byCode[failure.code] ?? GENERIC_MESSAGE;
  }
  if (failure.type === "client_outdated") {
    return "This version of the app is out of date. Reload the page to update.";
  }

  return GENERIC_MESSAGE;
}

/** What a name field says about a name that fails the length check before any request is sent. */
export function describeNameProblem(problem: ValidationFailure): string {
  return problem === "empty"
    ? "Enter a name."
    : `Names can be at most ${MAX_DISPLAY_NAME_LENGTH.toString()} characters.`;
}

/** The wording for a create or join that fails on the name, for the screens that ask for one. */
export const NAME_FAILURE_MESSAGES: MessagesByCode = {
  name_taken:
    "Someone already uses that name. If it's yours from another device, sign in. Otherwise, pick another.",
  // The form checks a typed name before sending, so these mean its view of the user's name was out
  // of date (see `nameWasStale`), and the form has just reloaded it.
  invalid_display_name: "Check your name and try again.",
  bad_request: "Check your name and try again.",
};

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
