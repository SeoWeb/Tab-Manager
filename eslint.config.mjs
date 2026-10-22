import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import prettier from 'eslint-plugin-prettier'
import prettierConfig from 'eslint-config-prettier'
import nextPlugin from '@next/eslint-plugin-next'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'backend/**',
      'frontend/**',
      'scripts/**',
      '*.config.{js,mjs,ts,cjs}',
      '*.{js,mjs,cjs}',
      'next-env.d.ts',
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      '.wrangler/**',
      'coverage/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react,
      '@next/next': nextPlugin,
      prettier,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'prettier/prettier': 'error',
      'react/react-in-jsx-scope': 'off',
      'no-undef': 'off',
      // Interactive controls must have an accessible name (cleanup-and-
      // regression-tests §4.1). The repo renders icon-only controls through
      // the shared `<Button>` wrapper (which emits a real `<button>`), so
      // both the DOM tag and the wrapper component are checked. Text-content
      // buttons pass automatically; icon-only ones need `aria-label`.
      //
      // KNOWN LIMITATION: the rule's label probe assumes any childless
      // PascalCase component (e.g. `<RotateCcw />` from lucide-react) may
      // render text, so a bare `<Button><Icon /></Button>` cannot be flagged
      // repo-wide without surfacing dozens of legacy violations in modules
      // owned by other workstreams. The panels override below closes that
      // loophole for the right-vertical-tabs panel family; widening it is a
      // deliberate follow-up, not a config accident.
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          controlComponents: ['Button', 'button', 'input', 'select', 'textarea'],
          depth: 3,
        },
      ],
    },
  },
  {
    // Stricter variant for the right-vertical-tabs panel family: the `'*'`
    // glob makes the label probe treat childless custom components (lucide
    // icons) as label-transparent, so a bare `<Button><Icon /></Button>`
    // fails lint. (The child probe matches with minimatch; top-level control
    // detection uses exact matching, so `'*'` only affects children.)
    files: ['src/components/right-vertical-tabs/panels/**/*.tsx'],
    rules: {
      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          controlComponents: [
            'Button',
            'button',
            'input',
            'select',
            'textarea',
            '*',
          ],
          depth: 3,
        },
      ],
    },
  },
  prettierConfig
)
