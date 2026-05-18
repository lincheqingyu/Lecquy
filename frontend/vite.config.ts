// 中文：本文件（vite.config.ts）位于 frontend/vite.config.ts，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (vite.config.ts) belongs to the frontend frontend 模块实现 layer in frontend/vite.config.ts, wiring upstream callers with downstream runtime logic.

/**
 * Vite 配置
 * 从 monorepo 根目录 .env 读取共享网络配置
 */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
    // 从根目录加载 .env
    const env = loadEnv(mode, '..', '')
    const backendPort = env.BACKEND_PORT || env.PORT || '3000'
    const frontendPort = Number(env.FRONTEND_PORT || '5173')
    const host = env.HOST || env.VITE_DEV_HOST || '0.0.0.0'
    const backendOrigin = env.BACKEND_ORIGIN || env.VITE_API_BASE || 'auto'
    const legacyWsBase = env.VITE_WS_BASE || 'auto'

    return {
        plugins: [
            react(),
            tailwindcss(),
        ],
        server: {
            host,
            port: frontendPort,
        },
        preview: {
            host,
            port: frontendPort,
        },
        // 从 monorepo 根目录读取 .env 文件
        envDir: '..',
        define: {
            // 统一使用 BACKEND_ORIGIN 覆盖前后端通信地址，默认按当前页面 + BACKEND_PORT 自动推导
            '__BACKEND_PORT__': JSON.stringify(backendPort),
            '__FRONTEND_PORT__': JSON.stringify(String(frontendPort)),
            '__BACKEND_ORIGIN__': JSON.stringify(backendOrigin),
            '__LEGACY_WS_BASE__': JSON.stringify(legacyWsBase),
        },
    }
})
