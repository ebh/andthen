// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionToken, resetSessionSource } from "../client/sessionToken";
import { clerk, resetClerk } from "./clerkStub";
import { ShareClerkSessionToken } from "./ShareClerkSessionToken";

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);

beforeEach(() => {
  resetClerk();
  resetSessionSource();
});

describe("ShareClerkSessionToken", () => {
  it("lets the API client fetch Clerk's token", async () => {
    vi.mocked(clerk.getToken).mockResolvedValue("tok-1");
    const pending = getSessionToken();

    render(<ShareClerkSessionToken />);

    expect(await pending).toBe("tok-1");
  });

  it("passes the fresh-token option through to Clerk", async () => {
    render(<ShareClerkSessionToken />);

    await getSessionToken({ fresh: true });

    expect(clerk.getToken).toHaveBeenCalledWith({ skipCache: true });
  });

  it("keeps the API client waiting while Clerk is still loading", async () => {
    clerk.isLoaded = false;
    const { rerender } = render(<ShareClerkSessionToken />);
    const pending = getSessionToken();
    vi.mocked(clerk.getToken).mockResolvedValue("tok-2");

    clerk.isLoaded = true;
    rerender(<ShareClerkSessionToken />);

    expect(await pending).toBe("tok-2");
  });
});
