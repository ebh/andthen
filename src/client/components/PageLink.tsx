import type { ReactNode } from "react";

import { navigate } from "../router";

interface PageLinkProps {
  /** The path of another page of the app. */
  to: string;
  className?: string;
  children: ReactNode;
}

/** A link to another page of the app that changes the page without reloading it. */
export function PageLink({ to, className, children }: PageLinkProps) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
