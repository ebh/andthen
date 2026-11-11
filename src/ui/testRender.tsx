import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { TamaguiProvider } from "tamagui";

import { tamaguiConfig } from "../../tamagui.config";
import { blockIdFor, type Block } from "../client/blocks";
import { BlocksContext, type BlocksValue } from "../client/useBlocks";

/** A user whose blocks have loaded and who has changed nothing. Pass fields to override them. */
export function fakeBlocks(overrides: Partial<BlocksValue> & { blocked?: readonly Block[] } = {}) {
  const { blocked = [], ...value } = overrides;

  return {
    status: "ready",
    blockIdFor: (userId) => blockIdFor(blocked, userId),
    change: () => undefined,
    working: null,
    error: null,
    ...value,
  } satisfies BlocksValue;
}

/**
 * Renders a page inside the app's Tamagui provider and `light` theme, as the root layout does,
 * with a user who blocks nobody. Pass `blocks` to stand in for a user who does.
 */
export function renderPage(page: ReactElement, blocks: BlocksValue = fakeBlocks()): RenderResult {
  return render(inTheme(page, blocks));
}

/** The page inside the provider, for `rerender`, which does not add one. */
export function inTheme(page: ReactElement, blocks: BlocksValue = fakeBlocks()): ReactElement {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      <BlocksContext.Provider value={blocks}>{page}</BlocksContext.Provider>
    </TamaguiProvider>
  );
}
