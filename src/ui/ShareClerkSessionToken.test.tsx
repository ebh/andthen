// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionToken, setSessionSource } from "../client/sessionToken";
import { clerk, resetClerk } from "./clerkStub";
import { ShareClerkSessionToken } from "./ShareClerkSessionToken";

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);

beforeEach(() => {
  resetClerk();
  setSessionSource(null);
});

describe("ShareClerkSessionToken", () => {
  // Pins the hand-off to the API client, which can't call hooks: a request made while Clerk is
  // loading waits for it, and a fresh token is passed through as Clerk's skipCache. Without it
  // early requests would go out unsigned, or a retry after a 401 would reuse the stale token.
  it("lets the API client wait for Clerk, then fetch its token, fresh when asked", async () => {
    clerk.isLoaded = false;
    const { rerender } = render(<ShareClerkSessionToken />);
    const pending = getSessionToken();
    vi.mocked(clerk.getToken).mockResolvedValue("tok-1");

    clerk.isLoaded = true;
    rerender(<ShareClerkSessionToken />);

    expect(await pending).toBe("tok-1");

    await getSessionToken({ fresh: true });

    expect(clerk.getToken).toHaveBeenLastCalledWith({ skipCache: true });
  });
});
