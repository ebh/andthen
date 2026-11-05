import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { TamaguiProvider } from "tamagui";

import { tamaguiConfig } from "../../tamagui.config";

/** Renders a page inside the app's Tamagui provider and `paper` theme, as the root layout does. */
export function renderPage(page: ReactElement): RenderResult {
  return render(
    <TamaguiProvider config={tamaguiConfig} defaultTheme="paper">
      {page}
    </TamaguiProvider>,
  );
}
