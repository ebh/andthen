import { parseAiConfig, SUGGESTION_TIMEOUT_MS } from "../config";
import { fakeProvider } from "./fake";
import type { SuggestionProvider } from "./provider";
import { withTimeout } from "./timeout";
import { createWorkersAiProvider } from "./workersAi";

const providers = new WeakMap<Env, SuggestionProvider>();

/** The provider `AI_PROVIDER` names. Parses the config once per `env`; a bad value throws. */
export function selectSuggestionProvider(env: Env): SuggestionProvider {
  const known = providers.get(env);
  if (known !== undefined) {
    return known;
  }

  const config = parseAiConfig(env);
  const provider =
    config.AI_PROVIDER === "fake"
      ? fakeProvider
      : withTimeout(
          createWorkersAiProvider({
            model: config.AI_MODEL,
            run: (model, input) => env.AI.run(model, input),
          }),
          SUGGESTION_TIMEOUT_MS,
        );
  providers.set(env, provider);

  return provider;
}
