import { useEffect, useState } from "react";

import { healthResponseSchema } from "../shared/api";

type ApiStatus = "checking" | "ok" | "down";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    void checkHealth().then(setApiStatus);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">And then…</h1>
      <div className="badge badge-outline">API: {apiStatus}</div>
    </main>
  );
}

async function checkHealth(): Promise<ApiStatus> {
  try {
    const response = await fetch("/api/health");
    healthResponseSchema.parse(await response.json());

    return "ok";
  } catch {
    return "down";
  }
}
