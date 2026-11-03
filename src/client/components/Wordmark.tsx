import { PageLink } from "./PageLink";

/** The app's name and the page's `h1`: a link home. */
export function Wordmark() {
  return (
    <h1>
      <PageLink to="/" className="font-story text-2xl font-semibold tracking-tight">
        And then…
      </PageLink>
    </h1>
  );
}
