import { z } from "zod";

import { generateSuggestions } from "./generate";
import { SUGGESTIONS_JSON_SCHEMA, type ChatMessage } from "./prompt";
import type { SuggestionProvider } from "./provider";

/** The part of the `AI` binding the provider uses: `env.AI.run`, so tests can stand one in. */
export type RunModel = (
  model: string,
  input: { messages: ChatMessage[]; response_format: unknown },
) => Promise<unknown>;

export interface WorkersAiOptions {
  model: string;
  run: RunModel;
}

// A Workers AI text model answers `{response}`: in JSON mode the already parsed object, else text.
const modelOutputSchema = z.object({ response: z.unknown() });

const JSON_MODE_UNMET = /JSON Mode couldn't be met/i;

export function createWorkersAiProvider({ model, run }: WorkersAiOptions): SuggestionProvider {
  return {
    suggest: (storyText) =>
      generateSuggestions(async (messages) => {
        try {
          const output = await run(model, {
            messages,
            response_format: { type: "json_schema", json_schema: SUGGESTIONS_JSON_SCHEMA },
          });
          const parsed = modelOutputSchema.safeParse(output);

          return parsed.success ? parsed.data.response : null;
        } catch (error) {
          // The model could not meet the schema: that is bad output, which the caller retries.
          if (error instanceof Error && JSON_MODE_UNMET.test(error.message)) {
            return null;
          }
          throw error;
        }
      }, storyText),
  };
}
