// 中文：本文件（main.tsx）位于 frontend/src/main.tsx，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (main.tsx) belongs to the frontend frontend 模块实现 layer in frontend/src/main.tsx, wiring upstream callers with downstream runtime logic.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import {App} from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
