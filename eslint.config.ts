import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import checkFile from "eslint-plugin-check-file";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { noComments } from "./lint/no-comments.ts";

export default defineConfig(
  { ignores: ["out/", "release/", "verify-output/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { satellite: { rules: { "no-comments": noComments } }, "check-file": checkFile },
    rules: {
      "satellite/no-comments": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "Use a named export." },
        { selector: 'ExportSpecifier[exported.name="default"]', message: "Use a named export." },
      ],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.{ts,tsx}": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],
      "check-file/folder-naming-convention": [
        "error",
        {
          "src/**/": "KEBAB_CASE",
          "verify/**/": "KEBAB_CASE",
          "lint/**/": "KEBAB_CASE",
          "scripts/**/": "KEBAB_CASE",
        },
      ],
      "check-file/filename-blocklist": ["error", { "**/index.{ts,tsx}": "*.ts" }],
    },
  },
  {
    files: ["src/renderer/**/*.tsx", "src/renderer/**/*.ts"],
    ...reactHooks.configs.flat.recommended,
  },
  { files: ["*.config.ts"], rules: { "no-restricted-syntax": "off" } },
);
