import type { BlocksResponse } from "../shared/api";
import type { ApiResult } from "./api";

/**
 * Where the user's list of blocks stands. `failed` means the last load did not arrive, so who is
 * blocked is unknown.
 */
export type BlocksStatus = "loading" | "ready" | "failed";

export type BlockAction = "block" | "unblock";

export type Block = BlocksResponse["blocks"][number];

/** The user's blocks and whether they are known. */
export interface BlocksLoad {
  status: BlocksStatus;
  blocks: readonly Block[];
}

/** Whether the user pressed a stand-in to show a blocked author's passage, and for which block. */
export interface Reveal {
  blockId: string | null;
  shown: boolean;
}

/** The API calls a change can make. Passed in so a test can fake them. */
export interface BlockCalls<Blocked, Unblocked> {
  blockUser: (request: { blockedUserId: string }) => Blocked;
  unblockUser: (blockId: string) => Unblocked;
}

/** What the list is before its first load, and after a sign-out drops the previous account's. */
export const BLOCKS_LOADING: BlocksLoad = { status: "loading", blocks: [] };

/**
 * The load after a reload's reply. A failed reload keeps the old list for lookups but is not
 * ready: after a Block, the old list does not hold the new block, so nothing may be shown on its
 * word.
 */
export function nextBlocksLoad(
  previous: BlocksLoad,
  result: ApiResult<BlocksResponse>,
): BlocksLoad {
  if (result.ok) {
    return { status: "ready", blocks: result.value.blocks };
  }

  return { status: "failed", blocks: previous.blocks };
}

/**
 * The call that carries out a Block or Unblock of `userId`, or null when there is nothing to send:
 * an Unblock of a user the user does not block.
 */
export function blockRequest<Blocked, Unblocked>(
  action: BlockAction,
  blocks: readonly Block[],
  userId: string,
  calls: BlockCalls<Blocked, Unblocked>,
): (() => Blocked | Unblocked) | null {
  if (action === "block") {
    return () => calls.blockUser({ blockedUserId: userId });
  }

  const blockId = blockIdFor(blocks, userId);

  return blockId === null ? null : () => calls.unblockUser(blockId);
}

/** The ID of the user's block on `userId`, or null when they have none. */
export function blockIdFor(blocks: readonly Block[], userId: string): string | null {
  return blocks.find((block) => block.blockedUserId === userId)?.id ?? null;
}

/**
 * The reveal after the passage's author block is looked up again. A new block, or none, hides the
 * passage again; a reload that keeps the same block keeps the reveal. Returns `reveal` itself when
 * nothing changed, so it is safe to store without a render loop.
 */
export function revealFor(reveal: Reveal, blockId: string | null): Reveal {
  return reveal.blockId === blockId ? reveal : { blockId, shown: false };
}

/**
 * Whether an opening is shown as an obscured stand-in. An opening whose author is unknown, because
 * an older Worker sent no `openingAuthorId`, is obscured too: the page cannot tell whether it is
 * blocked, so it fails closed.
 */
export function isOpeningObscured(
  blocks: { status: BlocksStatus; blockIdFor: (userId: string) => string | null },
  openingAuthorId: string | undefined,
): boolean {
  if (openingAuthorId === undefined) {
    return true;
  }

  return isObscured(blocks.status, blocks.blockIdFor(openingAuthorId), false);
}

/**
 * Whether a passage by this author is shown as an obscured stand-in. It fails closed: until the
 * list has loaded, nobody else's passage is shown, so a blocked author's text never flashes. The
 * user's own passages are never hidden, because no one blocks themselves.
 */
export function isObscured(
  status: BlocksStatus,
  blockId: string | null,
  authorIsUser: boolean,
): boolean {
  if (authorIsUser) {
    return false;
  }

  return status !== "ready" || blockId !== null;
}
