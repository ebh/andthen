import { z } from "zod";

import { storyIdSchema } from "../shared/api";

/**
 * Where one page of the list of a user's stories ended: the sort key of its last story. The next
 * page is every story that sorts after this key, so it stays right when that story has since
 * moved or left the list.
 */
export interface StoryCursor {
  isMyTurn: boolean;
  /** When the story's newest passage was written, in ms. */
  latestAt: number;
  id: string;
}

const storyCursorSchema = z.object({
  isMyTurn: z.boolean(),
  latestAt: z.number().int().nonnegative(),
  id: storyIdSchema,
});

/** Opaque to clients: base64url of the key's JSON, which only holds ASCII. */
export function encodeStoryCursor(cursor: StoryCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Null for anything `encodeStoryCursor` could not have made. */
export function decodeStoryCursor(raw: string): StoryCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    return null;
  }

  try {
    const json = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = storyCursorSchema.safeParse(JSON.parse(json));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
