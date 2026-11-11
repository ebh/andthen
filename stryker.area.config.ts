import base from "./stryker.config.json" with { type: "json" };

// One shard of the CI mutation run. stryker.config.json stays the only place that lists the
// excluded files: this keeps its `!` entries and swaps the includes for one area's folder.
// The CLI's --mutate replaces the whole list, so it can't do this.
const areas = ["shared", "worker", "client", "ui"];
const area = process.env["STRYKER_AREA"];
if (area === undefined || !areas.includes(area)) {
  throw new Error(`Set STRYKER_AREA to one of ${areas.join(", ")}; got ${String(area)}.`);
}

export default {
  ...base,
  mutate: [
    `src/${area}/**/*.ts`,
    `src/${area}/**/*.tsx`,
    ...base.mutate.filter((pattern) => pattern.startsWith("!")),
  ],
};
