import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architectural boundaries are enforced here, not just documented:
 *
 *  - src/engine  : pure deterministic simulation. No imports from outside the engine,
 *                  no wall clock, no ambient randomness, no platform-dependent math.
 *  - src/server  : server-only code (secrets, database, provider SDK).
 *  - everything else must never import server code or server-only packages.
 */

const NON_DETERMINISTIC_MATH = [
  "random",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "expm1",
  "log",
  "log2",
  "log10",
  "log1p",
  "pow",
  "cbrt",
  "hypot",
];

const engineRestrictedGlobals = [
  "Date",
  "performance",
  "window",
  "document",
  "navigator",
  "process",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "fetch",
  "crypto",
  "localStorage",
  "indexedDB",
  "console",
].map((name) => ({
  name,
  message: `'${name}' is forbidden in src/engine: the engine must be pure and deterministic.`,
}));

const SERVER_ONLY_PACKAGES = ["pg", "@electric-sql/pglite", "@anthropic-ai/sdk", "server-only"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "evidence/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".data/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    name: "engine-purity",
    files: ["src/engine/**/*.ts"],
    ignores: ["src/engine/**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", ...engineRestrictedGlobals],
      "no-restricted-properties": [
        "error",
        ...NON_DETERMINISTIC_MATH.map((property) => ({
          object: "Math",
          property,
          message: `Math.${property} is not guaranteed bit-identical across JS engines; use the helpers in src/engine/core/math.ts.`,
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.{1,2}/)(?!@/engine/).+",
              message: "src/engine may only import from within src/engine (relative paths or @/engine/*).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "No wall-clock time in the engine.",
        },
        {
          selector: "ForInStatement",
          message: "for..in iteration order is not a contract; iterate arrays or sorted keys.",
        },
      ],
    },
  },
  {
    name: "no-server-in-client",
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**", "src/proxy.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SERVER_ONLY_PACKAGES.map((name) => ({
            name,
            message: `'${name}' is server-only. Import it only under src/server or src/app/api.`,
          })),
          patterns: [
            {
              group: ["@/server/*", "@/server", "node:*"],
              message: "Server-only modules must not be imported from client/shared code.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "render-is-not-react",
    files: ["src/render/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "The render adapter is framework-free." },
            { name: "react-dom", message: "The render adapter is framework-free." },
          ],
          patterns: [{ group: ["@/server/*", "@/ui/*", "node:*"], message: "Not allowed in the render adapter." }],
        },
      ],
    },
  },
]);

export default eslintConfig;
