import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const nodeGlobals = Object.fromEntries(
  [
    "AbortController",
    "AbortSignal",
    "Buffer",
    "URL",
    "clearTimeout",
    "console",
    "fetch",
    "globalThis",
    "process",
    "queueMicrotask",
    "setImmediate",
    "setTimeout",
    "window",
  ].map((name) => [name, "readonly"]),
);

export default [
  { ignores: ["apps/desktop-app/dist/**", "apps/desktop-app/node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{mjs,cjs}"],
    languageOptions: { globals: nodeGlobals },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.mts"],
    rules: { "no-unused-vars": "off" },
  },
];
