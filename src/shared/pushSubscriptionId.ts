/**
 * The ID of a push subscription: the SHA-256 of its endpoint as 64 lowercase hex characters.
 * The Worker and the browser both derive it, so it must stay a pure function of the endpoint:
 * the client puts it in the path, and the Worker refuses a path that does not match the body.
 */
export async function pushSubscriptionIdOf(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
