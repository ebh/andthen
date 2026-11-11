import { describe, expect, it } from "vitest";

import { LEGAL_PAGE_PREFIX, legalPageUrl } from "./legalPageUrl";

describe("legalPageUrl", () => {
  // Pins the two address shapes that the footer links, the service worker and the Worker assets share.
  it("is the document address without a version", () => {
    expect(legalPageUrl("privacy-policy")).toBe("/legal/privacy-policy");
  });

  it("is the version address with a version", () => {
    expect(legalPageUrl("copyright-terms/equal-shares", 1)).toBe(
      "/legal/copyright-terms/equal-shares/v1",
    );
  });

  // A bare `/legal` is a valid story ID, so the prefix must keep its trailing slash.
  it("keeps the trailing slash on the prefix", () => {
    expect(LEGAL_PAGE_PREFIX).toBe("/legal/");
  });
});
