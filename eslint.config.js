import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // All generated: build output (the app's and any package's), and the
  // reports the test suites write.
  globalIgnores(['**/dist', 'playwright-report', 'test-results', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // Matches the `target` in tsconfig.app.json. Left at 2020 this was below
      // what the compiler emits, so syntax the build accepts could still trip
      // the parser.
      ecmaVersion: 2022,
      globals: globals.browser,
      // Type-aware linting. `projectService` resolves each file through the
      // tsconfig that already owns it (app / node / e2e), so the lint and the
      // build agree on types rather than maintaining a second project list.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Honour the TypeScript convention of prefixing intentionally unused
      // identifiers with _  (common in interface implementations).
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: {
      // This engine extracts fields whose names collide with Object.prototype
      // members on purpose — `toString`, `valueOf`, `hasOwnProperty` are the
      // subject of prototypeFieldNames.test.ts. Reading `fields['toString']`
      // resolves to the index signature, but the rule matches on the property
      // name and reports every such assertion as an unbound method. The one
      // remaining use is deliberate too (capturing RegExp.prototype.exec to
      // restore it after a spy), and the rule guards against accidental `this`
      // rebinding in shipped code, which is where it stays enabled.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // The MCP server's tests assert over JSON.parse'd tool output, which is
    // `any` by construction — every access would need a hand-written type
    // guard that restates the expect() right next to it. The unsafe-* family
    // stays on for the package's shipped code.
    files: ['packages/mcp-server/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // End-to-end tests and the Playwright config run in Node, not the browser,
    // and export helpers alongside their fixtures — neither of which the
    // browser-globals / react-refresh defaults above are about.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      // Playwright fixtures take a callback named `use`, which the React rule
      // reads as a hook call outside a component.
      'react-hooks/rules-of-hooks': 'off',
    },
  },
])
