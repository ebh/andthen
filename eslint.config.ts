import { defineConfig, globalIgnores } from "eslint/config";
import oxlint from "eslint-plugin-oxlint";
import tseslint from "typescript-eslint";

const SHAPE_MESSAGE =
  "Row and domain shapes are inferred from Zod schemas; see .claude/rules/database.md.";
const OBJECT_MESSAGE =
  "Row and table shapes live in rows.ts, tableSchemas.ts and typeSchemas.ts; see .claude/rules/database.md.";
const noShapes = [
  { selector: "TSInterfaceDeclaration", message: SHAPE_MESSAGE },
  { selector: "TSTypeLiteral", message: SHAPE_MESSAGE },
  { selector: "TSMappedType", message: SHAPE_MESSAGE },
];
const SCHEMA_FILES = [
  "src/worker/db/rows.ts",
  "src/worker/db/tableSchemas.ts",
  "src/worker/db/typeSchemas.ts",
];

// oxlint runs first and owns every rule it implements; the oxlint config goes last so ESLint
// switches those rules off and runs only what oxlint lacks.
export default defineConfig(
  globalIgnores([
    "dist/**",
    ".expo/**",
    ".tamagui/**",
    "reports/**",
    ".stryker-tmp/**",
    ".wrangler/**",
    "test-results/**",
    "playwright-report/**",
    "worker-configuration.d.ts",
  ]),
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  // oxlint has no no-restricted-syntax, so the database shape rules live here.
  {
    files: ["src/worker/db/**/*.ts"],
    ignores: ["src/worker/db/**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...noShapes] },
  },
  // A later block replaces the rule's options, so this one repeats noShapes.
  {
    files: ["src/worker/db/**/*.ts"],
    ignores: [...SCHEMA_FILES, "src/worker/db/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noShapes,
        {
          selector:
            "CallExpression[callee.object.name='z'][callee.property.name=/^(object|strictObject|looseObject)$/]",
          message: OBJECT_MESSAGE,
        },
        {
          selector:
            "ImportDeclaration[source.value='zod'] ImportSpecifier[imported.name=/^(object|strictObject|looseObject)$/]",
          message: OBJECT_MESSAGE,
        },
        {
          selector: "CallExpression[callee.property.name=/^(extend|safeExtend|merge)$/]",
          message:
            "Row shapes are built in rows.ts, from the table schemas; see .claude/rules/database.md.",
        },
      ],
    },
  },
  oxlint.buildFromOxlintConfigFile("./.oxlintrc.json", { typeAware: true }),
);
