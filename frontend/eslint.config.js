// 中文：本文件（eslint.config.js）位于 frontend/eslint.config.js，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (eslint.config.js) belongs to the frontend frontend 模块实现 layer in frontend/eslint.config.js, wiring upstream callers with downstream runtime logic.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
