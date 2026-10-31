import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The `AI` binding is always remote, so `pnpm dev` can only start without Cloudflare credentials
// when remote bindings are off. `AI_REMOTE=1 pnpm dev` (after `wrangler login`) turns them on.
// This must be a shell variable: `.dev.vars` is read by the Worker, not by this file.
const remoteBindings = process.env["AI_REMOTE"] === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings })],
});
