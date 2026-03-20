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
    const port = env.PORT || '3000'
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
        },
        // 从 monorepo 根目录读取 .env 文件
        envDir: '..',
        define: {
            // 统一使用 BACKEND_ORIGIN 覆盖前后端通信地址，默认按当前页面 + PORT 自动推导
            '__BACKEND_PORT__': JSON.stringify(port),
            '__BACKEND_ORIGIN__': JSON.stringify(backendOrigin),
            '__LEGACY_WS_BASE__': JSON.stringify(legacyWsBase),
        },
    }
})
