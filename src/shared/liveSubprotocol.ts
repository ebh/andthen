/**
 * The WebSocket subprotocol of the live socket. A browser can't set headers on a WebSocket, so a
 * signed-in client offers `[LIVE_SUBPROTOCOL, <session token>]` and the Worker reads the token
 * from the second entry. A browser closes a socket whose answer isn't one of the offered
 * subprotocols, so the Worker always answers with `LIVE_SUBPROTOCOL` alone, never the token.
 */
export const LIVE_SUBPROTOCOL = "andthen-live";

export interface OfferedSubprotocols {
  offersLive: boolean;
  /** The first offered entry that is not `LIVE_SUBPROTOCOL`, or null when there is none. */
  sessionToken: string | null;
}

/** The subprotocols a client offers when it opens the live socket: only `LIVE_SUBPROTOCOL` when anonymous. */
export function liveSubprotocolsFor(sessionToken: string | null): string[] {
  return sessionToken === null ? [LIVE_SUBPROTOCOL] : [LIVE_SUBPROTOCOL, sessionToken];
}

/** Splits a `Sec-WebSocket-Protocol` request header into what the client offered. */
export function readOfferedSubprotocols(header: string | null | undefined): OfferedSubprotocols {
  const offered = (header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  return {
    offersLive: offered.includes(LIVE_SUBPROTOCOL),
    sessionToken: offered.find((entry) => entry !== LIVE_SUBPROTOCOL) ?? null,
  };
}
