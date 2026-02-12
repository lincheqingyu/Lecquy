import { useState, useEffect } from 'react'
import { ConversationArea } from './ConversationArea'
import { SettingsDrawer } from './SettingsDrawer'

/**
 * 主布局容器
 *
 * 职责：
 * 1. 管理设置抽屉的开关状态（isSettingsOpen）
 * 2. 管理亮/暗色主题切换（isDark）
 * 3. 用 Flexbox 横向排列：对话区域 | 设置抽屉
 */
export function HomePageLayout() {
    // ---------- 状态管理 ----------

    // 控制设置抽屉是否展开
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)

    // 控制亮/暗色主题
    // useState<boolean> ← TypeScript 会自动推断类型，这里不需要手动标注
    const [isDark, setIsDark] = useState(false)

    // ---------- 副作用：同步主题到 <html> 标签 ----------

    /**
     * useEffect 是 React 的"副作用钩子"（Effect Hook）
     *
     * 为什么需要它？
     * → 暗色模式需要给 <html> 加上 class="dark"
     * → 直接操作 DOM 属于"副作用"，必须放在 useEffect 里
     * → 依赖数组 [isDark] 表示：只在 isDark 变化时执行
     */
    useEffect(() => {
        // document.documentElement 就是 <html> 元素
        if (isDark) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDark])

    // ---------- 事件处理函数 ----------

    const handleSettingsToggle = () => {
        setIsSettingsOpen((prev) => !prev)
    }

    const handleSettingsClose = () => {
        setIsSettingsOpen(false)
    }

    const handleThemeToggle = () => {
        setIsDark((prev) => !prev)
    }

    // ---------- 渲染 ----------

    return (
        <div
            className={[
                // 布局：弹性盒子，铺满屏幕，禁止溢出
                "flex h-screen w-screen overflow-hidden",
                // 外观：使用语义化主题色（亮/暗模式自动切换）
                "bg-surface-alt text-text-primary font-sans",
                // 过渡：切换主题时颜色平滑过渡
                "transition-colors duration-300",
            ].join(" ")}
        >
            <ConversationArea
                isSettingsOpen={isSettingsOpen}
                onSettingsToggle={handleSettingsToggle}
                onSettingsClose={handleSettingsClose}
                isDark={isDark}
                onThemeToggle={handleThemeToggle}
            />
            <SettingsDrawer
                isOpen={isSettingsOpen}
                onClose={handleSettingsClose}
                isDark={isDark}
                onThemeToggle={handleThemeToggle}
            />
        </div>
    )
}