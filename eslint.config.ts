import { defineConfig, globalIgnores } from "eslint/config";
import oxlint from "eslint-plugin-oxlint";
import tseslint from "typescript-eslint";

// oxlint runs first and owns every rule it implements; the oxlint config goes last so ESLint
// switches those rules off and runs only what oxlint lacks.
export default defineConfig(
  globalIgnores([
    "dist/**",
    "reports/**",
    ".stryker-tmp/**",
    ".wrangler/**",
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
  oxlint.buildFromOxlintConfigFile("./.oxlintrc.json", { typeAware: true }),
);
