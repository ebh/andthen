import { useAuth } from "@clerk/expo";
import { useEffect } from "react";

import { setSessionSource } from "../client/sessionToken";

/** Hands Clerk's auth state to `src/client/api.ts`, which can't call hooks. Renders nothing. */
export function SessionTokenSource() {
  const { isLoaded, getToken } = useAuth();

  useEffect(() => {
    setSessionSource({ isLoaded, getToken });
  }, [isLoaded, getToken]);

  return null;
}
