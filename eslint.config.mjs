/**
 * ESLint flat config.
 *
 * Next 16 removed the `next lint` command and `next build` no longer runs
 * linting, so ESLint is invoked directly (`npm run lint`). The flat format is
 * also what ESLint 10 will require — `.eslintrc.json` is no longer read.
 *
 * NOTE ON THE ESLINT VERSION: pinned to 9.x on purpose. `eslint-config-next`
 * declares `eslint: >=9.0.0`, but it bundles `eslint-plugin-react@7.37.5`,
 * whose own peer range stops at `^9.7` and which still calls the
 * `context.getFilename()` API that ESLint 10 removed. On ESLint 10 every lint
 * run dies with "contextOrFilename.getFilename is not a function". Revisit when
 * eslint-config-next ships a react plugin that supports 10.
 */

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    // Build output, deps and coverage are never worth linting. Flat config has
    // no `.eslintignore`, so ignores live here.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/sw.js", // service worker: browser SW globals, not app code
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // ── Pre-existing findings, deliberately WARN not ERROR ────────────────
      // These two rules are new in eslint-config-next 16 (React Compiler-aware
      // lint). They flag five call sites that predate the Next 16 upgrade and
      // are working code — see AUDIT_SUMMARY.md "React Compiler lint" for the
      // list. Rewriting five components' state flow does not belong in a
      // dependency upgrade, and this repo has no React rendering tests to
      // catch a mistake made while doing it. Warned so they stay visible;
      // raise back to "error" once the call sites are fixed.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",

      // `const { _dirty, ...rest } = row` is the deliberate idiom for dropping
      // a local-only column before it goes to Supabase — the binding exists to
      // be discarded, so neither it nor an `_`-prefixed name is dead code.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];

export default config;
