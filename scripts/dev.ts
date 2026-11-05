#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request, type IncomingMessage } from "node:http";
import { connect } from "node:net";

/**
 * `pnpm dev`: the Expo dev server and `wrangler dev` behind one origin.
 *
 * The browser must see a single origin, or the API's same-origin check and the `SameSite=Lax`
 * cookie reject its calls. `/api/*`, including the live WebSocket upgrade, goes to the Worker and
 * everything else goes to Metro.
 */

const PROXY_PORT = 5173;
const WORKER_PORT = 8787;
const METRO_PORT = 8081;

// The `AI` binding is always remote, so wrangler can only start without Cloudflare credentials
// with remote bindings off. `AI_REMOTE=1 pnpm dev` (after `wrangler login`) turns them on.
const remoteAi = process.env["AI_REMOTE"] === "1";

const children: ChildProcess[] = [
  spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      ...(remoteAi ? [] : ["--local"]),
      "--config",
      "wrangler.jsonc",
      "--port",
      WORKER_PORT.toString(),
    ],
    { stdio: "inherit" },
  ),
  spawn("pnpm", ["exec", "expo", "start", "--web", "--port", METRO_PORT.toString()], {
    stdio: "inherit",
    // `expo start` would otherwise rewrite tsconfig.json.
    env: { ...process.env, EXPO_NO_TYPESCRIPT_SETUP: "1" },
  }),
];

for (const child of children) {
  child.on("exit", stop);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const server = createServer((clientReq, clientRes) => {
  const upstream = request(
    {
      host: "localhost",
      port: upstreamPort(clientReq),
      method: clientReq.method,
      path: clientReq.url,
      headers: clientReq.headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );
  upstream.on("error", () => {
    clientRes.writeHead(502).end("The dev server behind the proxy is not ready yet.");
  });
  clientReq.pipe(upstream);
});

// Replays the upgrade request to the upstream server, then joins the two sockets.
server.on("upgrade", (clientReq, clientSocket, head) => {
  const upstreamSocket = connect(upstreamPort(clientReq), "localhost", () => {
    const headers = pairs(clientReq.rawHeaders)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join("");
    upstreamSocket.write(
      `${clientReq.method ?? "GET"} ${clientReq.url ?? "/"} HTTP/1.1\r\n${headers}\r\n`,
    );
    upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstreamSocket.destroy());
});

server.listen(PROXY_PORT, "localhost", () => {
  console.log(`Open http://localhost:${PROXY_PORT.toString()}`);
});

function stop(): void {
  for (const child of children) {
    child.kill();
  }
  process.exit(0);
}

function upstreamPort(req: IncomingMessage): number {
  return req.url?.startsWith("/api/") === true ? WORKER_PORT : METRO_PORT;
}

function pairs(flat: string[]): [string, string][] {
  const result: [string, string][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    result.push([flat[i] ?? "", flat[i + 1] ?? ""]);
  }
  return result;
}
