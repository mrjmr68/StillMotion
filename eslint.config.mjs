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
  ]),

  /**
   * The stage targets an ES2015 engine.
   *
   * Spec §3 puts `/stage` on a smart-TV browser and asks for ES2015 output with
   * "no optional chaining in shipped output". Next 16's compile target is
   * `package.json` browserslist, which is GLOBAL — there is no per-route
   * target, so that requirement cannot be met by configuration.
   *
   * What we can do is make sure our own source never depends on the compiler
   * downleveling it, which keeps two escape hatches open: widening browserslist
   * globally, or lifting the stage out to hand-written vanilla JS. Neither is a
   * rewrite as long as this fence holds.
   *
   * It does NOT make React 19 or Next 16's own runtimes ES2015. Only a load on
   * the real television answers that.
   */
  {
    files: ["src/app/(stage)/**/*.{ts,tsx}", "src/lib/stage/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ChainExpression",
          message: "Stage code targets ES2015 — no optional chaining (?.).",
        },
        {
          selector: "LogicalExpression[operator='??']",
          message: "Stage code targets ES2015 — no nullish coalescing (??).",
        },
        {
          selector: "AssignmentExpression[operator=/^(\\?\\?|\\|\\||&&)=$/]",
          message: "Stage code targets ES2015 — no logical assignment operators.",
        },
        {
          selector: "MemberExpression[property.name='at']",
          message: "Array.prototype.at is ES2022 — index directly instead.",
        },
        {
          selector: "CallExpression[callee.name='structuredClone']",
          message: "structuredClone is not available on the target engine.",
        },
        {
          selector:
            "MemberExpression[object.name='Object'][property.name=/^(hasOwn|fromEntries)$/]",
          message: "Object.hasOwn/fromEntries postdate ES2015.",
        },
        {
          selector: "MemberExpression[object.name='Array'][property.name='flat']",
          message: "Array.prototype.flat is ES2019.",
        },
      ],
    },
  },
]);

export default eslintConfig;
