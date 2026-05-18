// 中文：本文件（page.tsx）位于 frontend/src/app/home/page.tsx，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (page.tsx) belongs to the frontend frontend 模块实现 layer in frontend/src/app/home/page.tsx, wiring upstream callers with downstream runtime logic.

import { HomePageLayout } from './components/HomePageLayout'

/**
 * 首页入口
 */
export function HomePage() {
  return <HomePageLayout />
}
