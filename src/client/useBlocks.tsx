import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { onDeviceUserAdded, onSignedOut } from "./account";
import { blockUser, listBlocks, unblockUser } from "./api";
import {
  BLOCKS_LOADING,
  blockIdFor,
  blockRequest,
  nextBlocksLoad,
  type BlocksLoad,
  type BlocksStatus,
} from "./blocks";
import { describeBlockFailure, describeBlockProgress, type BlockAction } from "./blockMessages";
import { createLatestRequest } from "./latestRequest";

/** A user a Block or Unblock names: the ID a passage's `authorId` holds, and the name to show. */
export interface BlockTarget {
  id: string;
  name: string;
}

export interface BlocksValue {
  /** Until it is `ready`, who is blocked is unknown, so a page must show other people's passages obscured. */
  status: BlocksStatus;
  /** The ID of the user's block on `userId`, or null. */
  blockIdFor: (userId: string) => string | null;
  /** Blocks the user, then reloads the list. Ignored while another change is out. */
  block: (user: BlockTarget) => void;
  /** Lifts the user's block on the user, then reloads the list. Ignored while another change is out. */
  unblock: (user: BlockTarget) => void;
  /** What is in flight, such as "Blocking…", until the list has reloaded; else null. */
  working: string | null;
  /** Why the last change failed, or null. Cleared by the next attempt. */
  error: string | null;
}

export const BlocksContext = createContext<BlocksValue | null>(null);

/**
 * Holds the user's one list of blocks for the whole app. Mount it once, above every page: a
 * block names a user, and every story shows that user's passages the same way.
 */
export function BlocksProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<BlocksLoad>(BLOCKS_LOADING);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest] = useState(createLatestRequest);
  const changing = useRef(false);

  const reload = useCallback((): Promise<void> => {
    const isLatest = latest.start();

    return (async () => {
      const result = await listBlocks();
      // A reply that a newer request has overtaken is dropped.
      if (isLatest()) {
        setLoad((previous) => nextBlocksLoad(previous, result));
      }
    })();
  }, [latest]);

  useEffect(() => {
    void reload();

    return () => {
      // Drops the reply of a request still in flight.
      latest.cancel();
    };
  }, [latest, reload]);

  // Joining an account merges the device user's blocks into the account's.
  useEffect(
    () =>
      onDeviceUserAdded(() => {
        void reload();
      }),
    [reload],
  );

  // The previous account's blocks must not outlive it: drop them at once, so the page fails
  // closed, then load the list of the anonymous user this browser now is.
  useEffect(
    () =>
      onSignedOut(() => {
        setLoad(BLOCKS_LOADING);
        void reload();
      }),
    [reload],
  );

  const change = useCallback(
    (action: BlockAction, user: BlockTarget): void => {
      const request = blockRequest(action, load.blocks, user, { blockUser, unblockUser });
      if (changing.current || request === null) {
        return;
      }

      changing.current = true;
      setWorking(describeBlockProgress(action));
      setError(null);
      void (async () => {
        const result = await request();
        if (result.ok) {
          await reload();
        } else {
          setError(describeBlockFailure(action, result.failure));
        }
        changing.current = false;
        setWorking(null);
      })();
    },
    [load.blocks, reload],
  );

  const value = useMemo<BlocksValue>(
    () => ({
      status: load.status,
      blockIdFor: (userId) => blockIdFor(load.blocks, userId),
      block: (user) => {
        change("block", user);
      },
      unblock: (user) => {
        change("unblock", user);
      },
      working,
      error,
    }),
    [load, working, error, change],
  );

  return <BlocksContext.Provider value={value}>{children}</BlocksContext.Provider>;
}

/** The user's blocks. Throws outside a `BlocksProvider`, because a page that guessed would show a blocked author's text. */
export function useBlocks(): BlocksValue {
  const value = useContext(BlocksContext);
  if (value === null) {
    throw new Error("useBlocks needs a BlocksProvider above it");
  }

  return value;
}
