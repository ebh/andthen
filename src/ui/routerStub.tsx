import { cloneElement } from "react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** Records what a page asks the router to open. */
export const push = vi.fn<(path: string) => void>();

/** What `useLocalSearchParams` returns; a test sets the route's parameters here. */
export const params: { [name: string]: string } = {};

/**
 * Stands in for `expo-router` in component tests, which have no navigation container.
 * `Link` only hands its `href` to its child, as `asChild` does.
 */
export const routerStub = {
  Link: ({ href, children }: { href: string; children: ReactElement<{ href?: string }> }) =>
    cloneElement(children, { href }),
  useRouter: () => ({ push }),
  useLocalSearchParams: () => params,
};
