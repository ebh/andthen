import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

import { TEST_JWT_KEY } from "./sessionToken";

export interface TestEnvOptions {
  /** Applies only the migrations whose file name sorts before this one, e.g. `0005_users.sql`. */
  migrateBefore?: string;
}

export interface TestEnv {
  env: Env;
  dispose: () => Promise<void>;
}

const ROOT_DIR = path.join(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations");

/**
 * Starts Miniflare from `wrangler.jsonc` (top-level, local dev env) with an in-memory D1 that
 * has every migration in `migrations/` applied, or only those before `migrateBefore`. Call
 * `dispose` when done, or the workerd process outlives the test file.
 *
 * `CLERK_JWT_KEY` is `TEST_JWT_KEY`, so `signSessionToken` tokens verify.
 *
 * The STORY_ROOM binding exists but can't reach the StoryRoom class: getPlatformProxy doesn't
 * run Durable Objects defined in the Worker itself.
 */
export async function createTestEnv(options: TestEnvOptions = {}): Promise<TestEnv> {
  const { env, dispose } = await getPlatformProxy<Env>({
    configPath: path.join(ROOT_DIR, "wrangler.jsonc"),
    persist: false,
    remoteBindings: false,
  });

  const { migrateBefore } = options;
  await applyMigrations(env.DB, (file) => migrateBefore === undefined || file < migrateBefore);
  // The committed var is a placeholder; tests sign tokens with a key made for the run.
  Object.defineProperty(env, "CLERK_JWT_KEY", { value: TEST_JWT_KEY, enumerable: true });

  return { env, dispose };
}

/** Applies one file from `migrations/`, for a test that seeds data before a migration runs. */
export async function applyMigration(db: D1Database, fileName: string): Promise<void> {
  await applyMigrations(db, (file) => file === fileName);
}

// One batch, in file-name order, so a later migration always sees the earlier ones.
async function applyMigrations(db: D1Database, include: (file: string) => boolean): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql") && include(file))
    .toSorted();
  const sqlByFile = await Promise.all(
    files.map((file) => readFile(path.join(MIGRATIONS_DIR, file), "utf8")),
  );
  const statements = sqlByFile.flatMap((sql) => unstable_splitSqlQuery(sql));

  await db.batch(statements.map((statement) => db.prepare(statement)));
}
