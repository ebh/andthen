export type ParsedApiLevel =
  | { type: "level"; level: number }
  | { type: "missing" }
  | { type: "invalid" };

/**
 * The API level this build speaks. A hand-bumped whole number: raise it only when a change breaks
 * clients that already shipped, such as removing or renaming a field they read. Adding an
 * optional field or a route does not need a bump.
 */
export const API_LEVEL = 2;

/** The oldest API level the Worker accepts. Raising it past a shipped client's level locks that client out. */
export const MIN_API_LEVEL = 2;

export const API_LEVEL_HEADER = "X-Api-Level";

const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

/**
 * Reads an `X-Api-Level` header value. Only plain positive decimal digits are a level: an empty
 * value, whitespace, a sign, a fraction, `0`, leading zeros (`03`) and a number too large to be
 * exact are all `invalid`. An absent header is `missing`, which is not an error.
 */
export function parseApiLevel(value: string | null | undefined): ParsedApiLevel {
  if (value === null || value === undefined) {
    return { type: "missing" };
  }

  const level = Number(value);
  if (!POSITIVE_DECIMAL.test(value) || !Number.isSafeInteger(level)) {
    return { type: "invalid" };
  }

  return { type: "level", level };
}
