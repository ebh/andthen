/**
 * Makes concurrent requests race for real. The first `requests` batches are each request's load
 * of the story; every one waits until all have loaded, so all of them then write against the
 * same stored version. Pass the result as `env` in `{ DB: gateLoads(...) }`.
 */
export function gateLoads(db: D1Database, requests: number): Pick<D1Database, "prepare" | "batch"> {
  let calls = 0;
  let loaded = 0;
  const everyoneLoaded = Promise.withResolvers<undefined>();

  return {
    prepare: (query) => db.prepare(query),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      calls += 1;
      const isLoad = calls <= requests;
      const results = await db.batch<T>(statements);

      if (isLoad) {
        loaded += 1;
        if (loaded === requests) {
          everyoneLoaded.resolve(undefined);
        }
        await everyoneLoaded.promise;
      }

      return results;
    },
  };
}
