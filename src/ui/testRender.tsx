import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { TamaguiProvider } from "tamagui";

import { tamaguiConfig } from "../../tamagui.config";

/** Renders a page inside the app's Tamagui provider and `light` theme, as the root layout does. */
export function renderPage(page: ReactElement): RenderResult {
  return render(inTheme(page));
}

/** The page inside the provider, for `rerender`, which does not add one. */
export function inTheme(page: ReactElement): ReactElement {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      {page}
    </TamaguiProvider>
  );
}
