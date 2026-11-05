import { Link } from "expo-router";
import { Anchor, H1 } from "tamagui";

/** The app's name and the page's `h1`: a link home. */
export function Wordmark() {
  return (
    <H1>
      <Link href="/" asChild>
        <Anchor fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600" color="color">
          And then…
        </Anchor>
      </Link>
    </H1>
  );
}
