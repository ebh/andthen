import { describe, expect, it } from "vitest";

import { LIVE_SUBPROTOCOL, readOfferedSubprotocols } from "./liveSubprotocol";

describe("readOfferedSubprotocols", () => {
  it("reads the live subprotocol and the session token after it", () => {
    expect(readOfferedSubprotocols(`${LIVE_SUBPROTOCOL}, abc.def.ghi`)).toEqual({
      offersLive: true,
      sessionToken: "abc.def.ghi",
    });
  });

  it("reads an anonymous client's offer as having no token", () => {
    expect(readOfferedSubprotocols(LIVE_SUBPROTOCOL)).toEqual({
      offersLive: true,
      sessionToken: null,
    });
  });

  it("reads a token whatever its position, and without the live subprotocol", () => {
    expect(readOfferedSubprotocols("abc, andthen-live")).toEqual({
      offersLive: true,
      sessionToken: "abc",
    });
    expect(readOfferedSubprotocols("abc")).toEqual({ offersLive: false, sessionToken: "abc" });
  });

  it("reads a missing or blank header as offering nothing", () => {
    for (const header of [undefined, null, "", " , "]) {
      expect(readOfferedSubprotocols(header)).toEqual({ offersLive: false, sessionToken: null });
    }
  });
});
