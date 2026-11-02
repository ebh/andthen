import { navigate } from "../router";

/** The app's name and the page's `h1`: a link home. */
export function Wordmark() {
  return (
    <h1>
      <a
        href="/"
        className="font-story text-2xl font-semibold tracking-tight"
        onClick={(event) => {
          event.preventDefault();
          navigate("/");
        }}
      >
        And then…
      </a>
    </h1>
  );
}
