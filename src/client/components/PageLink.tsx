import type { ReactNode } from "react";

import { navigate } from "../router";

interface PageLinkProps {
  /** The path of another page of the app. */
  to: string;
  className?: string;
  children: ReactNode;
}

/**
 * A link to another page of the app that changes the page without reloading it. A click with a
 * modifier key, or a middle click, is left to the browser, so "open in a new tab" still works.
 */
export function PageLink({ to, className, children }: PageLinkProps) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
