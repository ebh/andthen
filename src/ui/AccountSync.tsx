import { useAuth } from "@clerk/expo";
import { useEffect } from "react";

import { syncAccount } from "../client/account";

/**
 * Brings this device's stories into the account whenever a session is there: on app load, and
 * when someone signs in. Running on load makes a merge that was cut short heal itself.
 * Renders nothing.
 */
export function AccountSync() {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      void syncAccount();
    }
  }, [isLoaded, isSignedIn]);

  return null;
}
