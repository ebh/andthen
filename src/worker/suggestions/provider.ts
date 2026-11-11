/** Three distinct, non-empty continuations, each already cut to the passage length limit. */
export type Suggestions = [string, string, string];

/**
 * Why a provider gave nothing. It decides whether the caller keeps the quota slot:
 * - `model_error`: the call threw (outage, quota, network). Nothing was delivered, so the slot is refunded.
 * - `unusable_output`: the model answered, twice, with output that never parsed. Those calls cost
 *   money, so the slot is kept.
 * - `timed_out`: the call may still finish and be billed, so the slot is kept.
 */
export type SuggestionFailure = "model_error" | "unusable_output" | "timed_out";

export type SuggestionResult =
  | { ok: true; suggestions: Suggestions }
  | { ok: false; failure: SuggestionFailure };

export interface SuggestionProvider {
  /**
   * Never throws. Reads the story; writes nothing. Once `signal` aborts, no new model call may
   * start: the caller has stopped waiting.
   */
  suggest: (storyText: string, signal?: AbortSignal) => Promise<SuggestionResult>;
}

/**
 * Only an outage refunds: bad output and a timeout may already have been billed. Whoever adds a
 * failure kind must decide here whether it refunds.
 */
export function failureRefundsQuotaSlot(failure: SuggestionFailure): boolean {
  return failure === "model_error";
}

/** A provider that throws breaks its contract; the quota slot still gets settled. */
export async function askProvider(
  provider: SuggestionProvider,
  storyText: string,
): Promise<SuggestionResult> {
  try {
    return await provider.suggest(storyText);
  } catch (error) {
    console.error("Suggestion provider threw", error);
    return { ok: false, failure: "model_error" };
  }
}
