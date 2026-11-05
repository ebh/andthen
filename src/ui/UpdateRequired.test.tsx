// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderPage } from "./testRender";
import { UpdateRequired } from "./UpdateRequired";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpdateRequired", () => {
  it("says the app is out of date, under the wordmark's level-1 heading", () => {
    renderPage(<UpdateRequired />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();
    expect(screen.getByText("This version of And then… is out of date.")).toBeVisible();
  });

  it("offers one button, which reloads the page", () => {
    const reload = vi.fn<() => void>();
    vi.stubGlobal("location", { reload });
    renderPage(<UpdateRequired />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /stor/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
