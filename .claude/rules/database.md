---
paths:
  - "src/worker/db/**"
  - "migrations/**"
  - "docs/database.md"
---

# Database rules

The D1 schema is described once, in Zod, and every database type in the code is inferred from that description, so a drift fails a check. `docs/database.md` is generated from the table schemas and the migrated database: columns, types, keys and indexes come from the database, and descriptions come from Zod.

## Rules

- **Each table that `migrations/` creates has one table schema.** D1's own tables (`d1_migrations`, `sqlite_*`, `_cf_*`) have none.
  - Name: `<camelCaseTableName>TableSchema`.
  - File: `src/worker/db/tableSchemas.ts`, which exports no types.
  - Registration: in `TABLE_SCHEMAS`, under its SQL table name.
  - It covers every column in stored form, with no transforms.
  - Each key is the camelCase of the column name.
  - A nullable column ends in `.nullable()`.
  - A 0/1 flag is `z.union([z.literal(0), z.literal(1)])`.
  - Why: one place says what is stored, and tests can compare it with the migrated database.
- **Row schemas live in `src/worker/db/rows.ts`.** Build them from table schemas with `.pick()`, `.extend()`, `z.union()` and `z.intersection()`. Intersections have no `.pick()` or `.extend()`.
  - Use `.extend()` for joined, renamed, computed or transformed fields, such as `authorId` from `participant_id` or `startsParagraph` from 0/1 to a boolean.
  - An extended field that holds a column's value is built from `<table>TableSchema.shape.<key>`.
  - A field that narrows a column is `<table>TableSchema.shape.<key>`, its `.unwrap()`, or `z.null()`. Never restate a column's type.
  - `z.object` is allowed in `rows.ts` only for union branches and intersection members whose fields follow the narrowing rule above.
  - Row types are `z.infer` exports of `rows.ts`.
  - Rows read from SQLite's own catalogue (`pragma_*`, `sqlite_master`) have no table schema to build from, so their row schemas in `rows.ts` may be top-level `z.object`.
  - Why: a column's shape is written once, and a query only says which parts it reads.
- **`src/worker/db/` has no `interface` and no object type literal (test files excepted).** A type alias over a library type, such as `Db`, is allowed. Write inputs and composite results are Zod schemas in `src/worker/db/typeSchemas.ts`.
  - Export each as `export type X = z.infer<typeof xSchema>`.
  - A field whose key is a column key and holds that column's stored value comes from `.pick()` or `.shape.<key>`.
  - Any other field is written directly, such as a boolean `startsParagraph` input, `now` or `loadedVersion`.
  - A `TurnState` field is `z.custom<TurnState>()`.
  - Schemas in `typeSchemas.ts` are not exported, only their inferred types, because nothing parses them and Stryker leaves the file out. Parsed schemas go in `rows.ts`.
  - Why: a hand-written type can disagree with the table without any check noticing.
- **Every D1 row whose fields the code reads is parsed with a row schema from `rows.ts`.** `z.object`, `z.strictObject` and `z.looseObject` appear in `src/worker/db/` only in `rows.ts`, `tableSchemas.ts` and `typeSchemas.ts`.
  - Why: this is the repo rule "parse untyped data with Zod", kept in one place.
- **SQL aliases each selected column to its schema key.** Write `created_at AS createdAt`.
  - Why: a row then parses straight into its row schema, with no renaming step.
- **A migration that adds, changes or drops a table or column also updates `tableSchemas.ts`.** The same change regenerates `docs/database.md` with `pnpm db:docs`.
  - A new or changed column can make a legal document false. See `.claude/rules/legal-impact.md`.
  - Why: the schema and the reference must describe the database as it is after the migration.
- **Every table schema and every column carries `.meta({ description })`, called last in the chain.** Write `z.number().int().nullable().meta({ description: "..." })`.
  - `.nullable()`, `.optional()` or `.transform()` after `.meta()` hides the description inside the wrapper, where the reference and the test do not look.
  - Descriptions use the words in `docs/domain.md`.
  - Descriptions use ASCII characters only (Australian spelling, plain quotes and hyphens), because `oxfmt` pads the generated tables by display width and the generator refuses anything else.
  - Why: the generated reference reads these descriptions.

## How it is enforced

These checks run in CI and fail the build.

- **An ESLint `no-restricted-syntax` rule**, scoped to `src/worker/db/**` (test files excepted), bans `interface`, object type literals and mapped types. In every file except `rows.ts`, `tableSchemas.ts` and `typeSchemas.ts` it also bans `z.object`, `z.strictObject` and `z.looseObject` (called through `z` or imported by name from `zod`), and any call to `.extend`, `.safeExtend` or `.merge`.
- **A drift test** checks that the tables and columns in Zod equal those in the migrated database. It also compares `NOT NULL` (SQLite allows NULL in a non-INTEGER primary key; the check treats every primary key as required) with `.nullable()`, and the SQLite column type with the Zod base type (INTEGER with a number or number literals, TEXT with a string, a string enum or string literals).
- **A description test** (`src/worker/db/tableSchemas.test.ts`) checks that every table schema and column has a non-empty description, read the way the generator reads it.
- **A stale-doc check** fails when `docs/database.md` differs from what `pnpm db:docs` generates.
