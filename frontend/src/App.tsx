// 中文：本文件（App.tsx）位于 frontend/src/App.tsx，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (App.tsx) belongs to the frontend frontend 模块实现 layer in frontend/src/App.tsx, wiring upstream callers with downstream runtime logic.

import { HomePage } from './app/home/page'

/**
 * 应用根组件
 */
export function App() {
  return <HomePage />
}
