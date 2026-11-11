import { useCallback, useEffect, useState } from "react";

import { onDeviceUserAdded } from "./account";
import { fetchMe } from "./api";
import { createLatestRequest } from "./latestRequest";
import type { UserNameLoad } from "./userName";

const LOADING: UserNameLoad = { type: "loading" };

/**
 * Loads the user's display name when the form mounts, again on `reload`, and in place after a
 * device user is added to the account.
 */
export function useUserName(): { load: UserNameLoad; reload: () => void } {
  const [load, setLoad] = useState<UserNameLoad>(LOADING);
  const [latest] = useState(createLatestRequest);

  const fetchName = useCallback(() => {
    const isLatest = latest.start();

    void (async () => {
      const result = await fetchMe();
      // A reply that a newer request has overtaken is dropped.
      if (isLatest()) {
        setLoad(
          result.ok
            ? { type: "loaded", displayName: result.value.displayName }
            : { type: "failed", failure: result.failure },
        );
      }
    })();
  }, [latest]);

  useEffect(() => {
    fetchName();
  }, [fetchName]);

  // Joining an account can give the user the account's name. Refetched in place, so a form on
  // screen doesn't flash back to loading.
  useEffect(() => onDeviceUserAdded(fetchName), [fetchName]);

  const reload = (): void => {
    setLoad(LOADING);
    fetchName();
  };

  return { load, reload };
}
