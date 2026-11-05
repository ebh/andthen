import { afterEach } from "vitest";

import { installMatchMedia, resetScreen } from "./testScreen";

// Component tests opt into jsdom with a docblock; the rest of src/ui has no window.
if (typeof window !== "undefined") {
  installMatchMedia();
}

afterEach(() => {
  if (typeof window !== "undefined") {
    resetScreen();
  }
});
