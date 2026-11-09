import { Button } from "tamagui";

import { useAppInstall } from "../client/appInstall";

/** Offers to install the app where the browser has said it can. Absent everywhere else. */
export function InstallButton() {
  const { state, install } = useAppInstall();

  if (state.type !== "ready") {
    return null;
  }

  return (
    <Button
      variant="outlined"
      size="xl"
      disabled={state.busy}
      onPress={() => {
        void install();
      }}
    >
      Install the app
    </Button>
  );
}
