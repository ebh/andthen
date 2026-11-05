interface ScreenKind {
  /** At or above Tamagui's `md` breakpoint. */
  wide: boolean;
  /** A pointer that can hover, as `hoverable` in the config. */
  hover: boolean;
}

const listeners = new Set<() => void>();
let screenKind: ScreenKind = { wide: false, hover: false };

/**
 * Gives jsdom a `window.matchMedia` whose answers follow `setScreen`. Tamagui binds
 * `window.matchMedia` when it is first imported, so this must run before any test file imports it.
 */
export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const list: MediaQueryList = {
      get matches() {
        return answer(query);
      },
      media: query,
      onchange: null,
      // Tamagui subscribes with the deprecated pair, so a stand-in must offer it.
      // oxlint-disable-next-line typescript/no-deprecated
      addListener: (listener) => {
        listeners.add(() => {
          listener?.call(
            list,
            Object.assign(new Event("change"), { matches: list.matches, media: query }),
          );
        });
      },
      // oxlint-disable-next-line typescript/no-deprecated
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };

    return list;
  };
}

/** Switches the screen jsdom pretends to be and tells Tamagui, which re-reads it on each change. */
export function setScreen(next: ScreenKind): void {
  screenKind = next;
  for (const listener of listeners) {
    listener();
  }
}

export function resetScreen(): void {
  setScreen({ wide: false, hover: false });
}

function answer(query: string): boolean {
  if (query.includes("hover")) {
    return screenKind.hover;
  }

  return query.includes("min-width") === screenKind.wide;
}
