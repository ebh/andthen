import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

export interface TestEnv {
  env: Env;
  dispose: () => Promise<void>;
}

const ROOT_DIR = path.join(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations");

/**
 * Starts Miniflare from `wrangler.jsonc` (top-level, local dev env) with an in-memory D1 that
 * has every migration in `migrations/` applied. Call `dispose` when done, or the workerd
 * process outlives the test file.
 *
 * The STORY_ROOM binding exists but can't reach the StoryRoom class: getPlatformProxy doesn't
 * run Durable Objects defined in the Worker itself.
 */
export async function createTestEnv(): Promise<TestEnv> {
  const { env, dispose } = await getPlatformProxy<Env>({
    configPath: path.join(ROOT_DIR, "wrangler.jsonc"),
    persist: false,
    remoteBindings: false,
  });

  await applyMigrations(env.DB);

  return { env, dispose };
}

// One batch, in file-name order, so a later migration always sees the earlier ones.
async function applyMigrations(db: D1Database): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).toSorted();
  const sqlByFile = await Promise.all(
    files.map((file) => readFile(path.join(MIGRATIONS_DIR, file), "utf8")),
  );
  const statements = sqlByFile.flatMap((sql) => unstable_splitSqlQuery(sql));

  await db.batch(statements.map((statement) => db.prepare(statement)));
}
