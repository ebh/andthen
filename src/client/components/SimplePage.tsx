import type { ReactNode } from "react";

import { Wordmark } from "./Wordmark";

interface SimplePageProps {
  children: ReactNode;
}

/** A plain centred column under the wordmark, for pages with one short thing to say or do. */
export function SimplePage({ children }: SimplePageProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-5">
      <header>
        <Wordmark />
      </header>
      <main className="flex flex-col gap-4">{children}</main>
    </div>
  );
}
