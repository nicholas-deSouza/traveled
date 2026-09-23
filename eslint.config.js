import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const domAccessMessage = "Use React state, JSX, and refs instead of querying or manually modifying the DOM.";
const restrictedDomProperties = [
  "document",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "getElementsByTagNameNS",
  "getElementsByName",
  "createElementNS",
  "createTextNode",
  "createDocumentFragment",
  "innerHTML",
  "outerHTML",
  "innerText",
  "textContent",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "insertAdjacentText",
  "appendChild",
  "removeChild",
  "replaceChild",
  "replaceChildren",
  "insertBefore",
  "setAttribute",
  "removeAttribute",
  "toggleAttribute",
  "classList",
];

export default tseslint.config(
  { ignores: ["dist", "supabase"] },
  {
    files: [".github/scripts/**/*.mjs"],
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
      "no-restricted-globals": ["error", { name: "document", message: domAccessMessage }],
      "no-restricted-properties": [
        "error",
        ...restrictedDomProperties.map((property) => ({ property, message: domAccessMessage })),
      ],
    },
  },
);
