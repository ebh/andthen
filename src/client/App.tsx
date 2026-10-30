import { useEffect, useState } from "react";

import { healthResponseSchema } from "../shared/api";

type ApiStatus = "checking" | "ok" | "down";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const status = await checkHealth(controller.signal);
        if (!controller.signal.aborted) {
          setApiStatus(status);
        }
      } catch (error) {
        // An abort on unmount is expected; anything else surfaces as an unhandled rejection.
        if (!controller.signal.aborted) {
          throw error;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">And then…</h1>
      <div className="badge badge-outline">API: {apiStatus}</div>
    </main>
  );
}

// "down" covers a network failure, a non-2xx status or a body that isn't the health contract.
// Anything else (an abort, a bug here) still rejects.
async function checkHealth(signal: AbortSignal): Promise<ApiStatus> {
  let response: Response;
  try {
    response = await fetch("/api/health", { signal });
  } catch (error) {
    if (error instanceof TypeError) {
      return "down";
    }
    throw error;
  }

  if (!response.ok) {
    return "down";
  }

  const body = healthResponseSchema.safeParse(await response.json().catch(() => null));

  return body.success ? "ok" : "down";
}
