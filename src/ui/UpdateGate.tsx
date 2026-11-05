import { Slot } from "expo-router";

import { useClientOutdated } from "../client/clientOutdated";
import { UpdateRequired } from "./UpdateRequired";

/**
 * The page the route picks, or the update screen once the client is out of date. Swapping the
 * page out unmounts it, which closes its live socket, so nothing keeps retrying against a Worker
 * that refuses this build.
 */
export function UpdateGate() {
  return useClientOutdated() ? <UpdateRequired /> : <Slot />;
}
