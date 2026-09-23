import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import noDirectDom from "./eslint-rules/no-direct-dom.mjs";

export default tseslint.config(
  { ignores: ["dist", "supabase"] },
  {
    files: [".github/scripts/**/*.mjs", "eslint-rules/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { project: "./tsconfig.app.json", tsconfigRootDir: import.meta.dirname } },
    plugins: { local: { rules: { "no-direct-dom": noDirectDom } } },
    rules: {
      "no-restricted-globals": ["error", { name: "document", message: "Use React state, JSX, and refs instead of direct document access." }],
      "local/no-direct-dom": "error",
    },
  },
);
