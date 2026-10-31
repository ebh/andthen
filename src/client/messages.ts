import type { ApiFailure, ClientErrorCode } from "./api";

/** Messages for specific error codes in one place; anything not listed gets a generic one. */
export type MessagesByCode = { [code in ClientErrorCode]?: string };

/** Plain-language text for a failed call. `byCode` holds the wording for codes this screen expects. */
export function describeFailure(failure: ApiFailure, byCode: MessagesByCode = {}): string {
  if (failure.type === "network") {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (failure.type === "rejected") {
    return byCode[failure.code] ?? GENERIC_MESSAGE;
  }

  return GENERIC_MESSAGE;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
