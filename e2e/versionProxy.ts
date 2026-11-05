import { createServer, type Server, type ServerResponse } from "node:http";

export interface VersionProxy {
  /** Where a browser reaches the app through the proxy. */
  url: string;
  /** From now on, answers `/sw.js` with this script instead of the app's own. */
  replaceWorkerScript(script: string): void;
  close(): Promise<void>;
}

/**
 * Forwards every request to the running app, except that `/sw.js` can be swapped for another script.
 * This stands in for a deploy: Playwright's `route` does not see the browser's own check for a newer
 * service worker, and `wrangler dev` reads its asset list once, so editing `dist/sw.js` is not served.
 * Only GET is forwarded, which is all the pages these tests open need.
 */
export async function startVersionProxy(target: string): Promise<VersionProxy> {
  let workerScript: string | undefined;
  const server = createServer((request, response) => {
    if (request.url === "/sw.js" && workerScript !== undefined) {
      response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" });
      response.end(workerScript);

      return;
    }

    void answer(target, request.url ?? "/", request.headers.cookie, response);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The version proxy has no port");
  }

  return {
    url: `http://localhost:${address.port.toString()}`,
    replaceWorkerScript(script) {
      workerScript = script;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

async function answer(
  target: string,
  path: string,
  cookie: string | undefined,
  response: ServerResponse,
): Promise<void> {
  try {
    const { status, headers, body } = await forward(target, path, cookie);
    response.writeHead(status, headers);
    response.end(body);
  } catch {
    response.writeHead(502);
    response.end();
  }
}

async function forward(target: string, path: string, cookie: string | undefined) {
  const upstream = await fetch(new URL(path, target), {
    headers: cookie === undefined ? {} : { cookie },
    redirect: "manual",
  });
  const headers: { [name: string]: string } = {};
  for (const [name, value] of upstream.headers) {
    // `fetch` has already decoded the body, so its length and encoding no longer describe it.
    if (name !== "content-encoding" && name !== "content-length") {
      headers[name] = value;
    }
  }

  return {
    status: upstream.status,
    headers,
    body: Buffer.from(await upstream.arrayBuffer()),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
}
