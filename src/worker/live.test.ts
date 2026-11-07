import { describe, expect, it } from "vitest";

import { upgradeRequestForRoom, upgradeResponseHeaders } from "./live";

function upgrade(subprotocols?: string): Request {
  const headers = new Headers({ Upgrade: "websocket", Cookie: "andthen_bt=abc" });
  if (subprotocols !== undefined) {
    headers.set("Sec-WebSocket-Protocol", subprotocols);
  }

  return new Request("http://localhost/api/stories/abcde/live", { headers });
}

describe("upgradeRequestForRoom", () => {
  it("cuts the session token from the offered subprotocols and keeps the rest", () => {
    const forRoom = upgradeRequestForRoom(upgrade("andthen-live, a.b.c"));

    expect(forRoom.headers.get("Sec-WebSocket-Protocol")).toBe("andthen-live");
    expect(forRoom.headers.get("Upgrade")).toBe("websocket");
    expect(forRoom.headers.get("Cookie")).toBe("andthen_bt=abc");
    expect(forRoom.url).toBe("http://localhost/api/stories/abcde/live");
  });

  it("leaves an offer of andthen-live alone as it is", () => {
    const forRoom = upgradeRequestForRoom(upgrade("andthen-live"));

    expect(forRoom.headers.get("Sec-WebSocket-Protocol")).toBe("andthen-live");
  });

  it("drops subprotocols that do not include andthen-live, so a token can't reach the room", () => {
    const forRoom = upgradeRequestForRoom(upgrade("a.b.c"));

    expect(forRoom.headers.has("Sec-WebSocket-Protocol")).toBe(false);
  });

  it("sends no subprotocol when none was offered", () => {
    expect(upgradeRequestForRoom(upgrade()).headers.has("Sec-WebSocket-Protocol")).toBe(false);
  });
});

describe("upgradeResponseHeaders", () => {
  it("answers andthen-live alone when it was offered, with or without a token", () => {
    for (const offered of ["andthen-live", "andthen-live, a.b.c"]) {
      const headers = upgradeResponseHeaders(upgrade(offered));

      expect(headers.get("Sec-WebSocket-Protocol")).toBe("andthen-live");
    }
  });

  it("answers no subprotocol when andthen-live was not offered", () => {
    for (const offered of [undefined, "a.b.c"]) {
      expect(upgradeResponseHeaders(upgrade(offered)).has("Sec-WebSocket-Protocol")).toBe(false);
    }
  });
});
