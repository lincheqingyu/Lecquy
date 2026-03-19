/**
 * Vite 配置
 * 从 monorepo 根目录 .env 读取 PORT，自动派生前端 API 地址
 */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
    // 从根目录加载 .env
    const env = loadEnv(mode, '..', '')
    const port = env.PORT || '5000'

    return {
        plugins: [
            react(),
            tailwindcss(),
        ],
        server: {
            host: env.VITE_DEV_HOST || '0.0.0.0',
        },
        // 从 monorepo 根目录读取 .env 文件
        envDir: '..',
        define: {
            // 将 PORT 派生的地址注入前端，无需手动维护 VITE_API_BASE / VITE_WS_BASE
            '__BACKEND_PORT__': JSON.stringify(port),
            '__API_BASE__': JSON.stringify(env.VITE_API_BASE || 'auto'),
            '__WS_BASE__': JSON.stringify(env.VITE_WS_BASE || 'auto'),
        },
    }
})
