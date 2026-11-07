import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { setSessionSource } from "./sessionToken";

// Every test starts as an anonymous page load whose Clerk has loaded, so no API call waits for it.
beforeEach(() => {
  setSessionSource(null);
  setSessionSource({ isLoaded: true, getToken: () => Promise.resolve(null) });
});

afterEach(() => {
  cleanup();
});
