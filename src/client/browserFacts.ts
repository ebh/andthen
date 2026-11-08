/** The browser details that tell an Apple touch device from any other. */
export interface TouchFacts {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

// iPadOS 13 and later reports itself as a Mac, so a Mac with a touch screen is an iPad.
export function isAppleTouchDevice(facts: TouchFacts): boolean {
  return (
    /iPhone|iPad|iPod/.test(facts.userAgent) ||
    (facts.platform === "MacIntel" && facts.maxTouchPoints > 1)
  );
}

// `navigator.standalone` is Safari's own flag, absent from the DOM typings.
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}
