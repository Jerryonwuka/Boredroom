import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Aceternity UI components (fetched from ui.aceternity.com, see docs/design-system.md).
    // Third-party code kept close to upstream; it is not held to this project's lint rules.
    "src/components/aceternity/**",
    "src/hooks/use-outside-click.tsx",
  ]),
]);

export default eslintConfig;
