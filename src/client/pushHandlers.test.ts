import { describe, expect, it, vi } from "vitest";

import { openNotifiedStory, showPushedNotification, type OpenTab } from "./pushHandlers";

const ORIGIN = "https://app.andthen.page";
const STORY = `${ORIGIN}/abc12`;

const payload = {
  web_push: 8030,
  notification: {
    title: "Your turn",
    body: "Once upon a time",
    navigate: STORY,
    tag: "turn-abc12",
  },
};

describe("showPushedNotification", () => {
  it("shows the payload's title, body and tag, and keeps the address for the tap", async () => {
    const showNotification = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await showPushedNotification(JSON.stringify(payload), { showNotification });

    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Your turn", {
      body: "Once upon a time",
      tag: "turn-abc12",
      data: { navigate: STORY },
    });
  });

  it.each([
    ["no data", undefined],
    ["text that is not JSON", "not json"],
    ["JSON of another shape", JSON.stringify({ hello: "world" })],
    [
      "a payload without the web_push marker",
      JSON.stringify({ notification: payload.notification }),
    ],
    [
      "a payload with an address that is not a URL",
      JSON.stringify({ ...payload, notification: { ...payload.notification, navigate: "/abc12" } }),
    ],
  ])("shows nothing for %s", async (_name, text) => {
    const showNotification = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await showPushedNotification(text, { showNotification });

    expect(showNotification).not.toHaveBeenCalled();
  });
});

function tab(url: string): OpenTab & { focus: ReturnType<typeof vi.fn<() => Promise<void>>> } {
  return { url, focus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}

describe("openNotifiedStory", () => {
  it("focuses the tab already on the story and opens nothing", async () => {
    const other = tab(`${ORIGIN}/zzzzz`);
    const onStory = tab(STORY);
    const openTab = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

    await openNotifiedStory({ navigate: STORY }, ORIGIN, [other, onStory], openTab);

    expect(onStory.focus).toHaveBeenCalledTimes(1);
    expect(other.focus).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });

  it("opens the story when no tab is on it", async () => {
    const other = tab(`${ORIGIN}/zzzzz`);
    const openTab = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

    await openNotifiedStory({ navigate: STORY }, ORIGIN, [other], openTab);

    expect(openTab).toHaveBeenCalledExactlyOnceWith(STORY);
    expect(other.focus).not.toHaveBeenCalled();
  });

  it.each([
    ["an address on another site", { navigate: "https://evil.example/abc12" }],
    ["no address", {}],
    ["no data", undefined],
  ])("does nothing for %s", async (_name, data) => {
    const onStory = tab(STORY);
    const openTab = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

    await openNotifiedStory(data, ORIGIN, [onStory], openTab);

    expect(onStory.focus).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });
});
