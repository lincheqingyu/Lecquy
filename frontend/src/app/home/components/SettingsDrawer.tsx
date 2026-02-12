import { X, Moon, Sun } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * SettingsDrawer 的 Props
 *
 * 注意这里比之前多了两个属性：isDark 和 onThemeToggle
 * → 这是因为我们把"主题切换按钮"放在了设置抽屉里
 */
interface SettingsDrawerProps {
    isOpen: boolean
    onClose: () => void
    isDark: boolean               // 当前是否是暗色模式
    onThemeToggle: () => void     // 切换主题的回调
}

/**
 * 设置抽屉
 *
 * 动画原理：
 * → 抽屉始终在 DOM 中（不会被销毁/创建）
 * → 通过 translate-x-full（向右移出屏幕）和 translate-x-0（回到原位）来控制显隐
 * → transition-transform 让位移带有平滑动画
 * → 这比 display:none 的方式性能更好，因为 GPU 可以加速 transform 动画
 */
export function SettingsDrawer({
                                   isOpen,
                                   onClose,
                                   isDark,
                                   onThemeToggle,
                               }: SettingsDrawerProps) {
    return (
        <div
            className={clsx(
                // 定位：固定在视口右侧
                // 尺寸：占满高度，宽 320px
                "h-screen w-80 shrink-0",
                // 外观：背景 + 左侧边框
                "border-l border-border bg-surface",
                // 动画：平滑滑入/滑出
                "transition-transform duration-300 ease-in-out",
                // 条件样式：clsx 的核心价值 ——
                // 比模板字符串里写三元表达式更清晰
                isOpen ? "mr-0" : "-mr-80"
            )}
        >
            {/* ---------- 抽屉头部 ---------- */}
            <div
                className={[
                    "flex items-center justify-between",
                    "border-b border-border px-6 py-4",
                ].join(" ")}
            >
                <h2 className="text-lg font-semibold text-text-primary">设置</h2>
                <button
                    type="button"
                    onClick={onClose}
                    className={[
                        "flex items-center justify-center",
                        "size-8 rounded",
                        "text-text-secondary",
                        "transition-colors hover:bg-hover hover:text-text-primary",
                    ].join(" ")}
                    aria-label="关闭设置"
                >
                    <X className="size-5" />
                </button>
            </div>

            {/* ---------- 抽屉内容 ---------- */}
            <div className="p-6">
                {/* 主题切换 */}
                <div className="flex items-center justify-between">
                    <span className="text-text-secondary">外观</span>
                    <button
                        type="button"
                        onClick={onThemeToggle}
                        className={[
                            "flex items-center justify-center",
                            "size-10 rounded-full",
                            "text-text-secondary",
                            "transition-colors hover:bg-hover hover:text-text-primary",
                        ].join(" ")}
                        aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
                    >
                        {/* 根据当前主题显示不同图标 */}
                        {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}