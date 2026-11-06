#!/usr/bin/env node
import { generateVapidKeys } from "../src/worker/vapidKeys.ts";

/**
 * `pnpm vapid-keys`: prints a new VAPID key pair for Web Push. Put the public key in
 * `wrangler.jsonc` as `VAPID_PUBLIC_KEY` and store the private key as the Worker secret
 * `VAPID_PRIVATE_KEY` (docs/deployment.md, "Web Push keys"). Make one pair per environment: a
 * leaked private key lets anyone send notifications as this app.
 */
const { publicKey, privateKey } = await generateVapidKeys();

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
