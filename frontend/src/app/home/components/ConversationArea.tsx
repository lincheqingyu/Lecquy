import {Moon, Settings, Sun} from 'lucide-react'
import { ChatInput } from '../../../components/ui/ChatInput'
import { MessageList } from '../../../components/chat/MessageList'
import { useChat, type ModelConfig } from '../../../hooks/useChat'

/**
 * 组件的 Props 类型定义
 *
 * 这是 TypeScript 特有的语法，叫做 接口（Interface）
 * 类比：它就像一份"零件清单"，告诉 React：
 * "要使用 ConversationArea 这个组件，你必须传入以下三样东西"
 *
 * 每一行的格式是：属性名: 类型
 * → boolean 表示只能是 true 或 false
 * → () => void 表示"一个没有参数、没有返回值的函数"
 */
interface ConversationAreaProps {
    onSettingsToggle: () => void // 切换设置抽屉的回调函数
    isDark: boolean               // 当前是否是暗色模式
    onThemeToggle: () => void     // 切换主题的回调
    systemPrompt: string
    modelConfig: ModelConfig
}

/**
 * 区域 A：对话主页面
 *
 * 布局特征：
 * → flex-1 让它占据除 SettingsDrawer 之外的所有空间
 * → 包含一个浮动的设置按钮（右上角）
 */
export function ConversationArea({
                                     onSettingsToggle,
                                     isDark,
                                     onThemeToggle,
                                     systemPrompt,
                                     modelConfig,
                                 }: ConversationAreaProps) {
    const { mode, setMode, messages, send, isStreaming, isWaiting } = useChat({
        systemPrompt,
        modelConfig,
    })
    const hasSent = messages.length > 0

    return (
      <div
        className={[
          'relative flex-1 min-h-0',
          'border-r border-border bg-surface-alt',
        ].join(' ')}
      >
        <div className="flex h-full flex-col">
            <header className="h-12 shrink-0 bg-surface-alt/95 backdrop-blur">
            <div className="flex h-full w-full items-center justify-end px-4 md:px-6">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onThemeToggle}
                  className={[
                    'flex items-center justify-center',
                    'size-9 rounded-lg',
                    'text-text-secondary',
                    'transition-colors hover:bg-hover hover:text-text-primary',
                  ].join(' ')}
                  aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
                >
                  {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSettingsToggle()
                  }}
                  className={[
                    'flex items-center justify-center',
                    'size-9 rounded-lg',
                    'text-text-secondary',
                    'transition-colors hover:bg-hover hover:text-text-primary',
                  ].join(' ')}
                  aria-label="打开设置"
                >
                  <Settings className="size-5" />
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-0">
            {!hasSent ? (
              <div className="flex h-full flex-col items-center justify-center">
                <div className="mb-8 text-center">
                  <div className="text-2xl font-semibold text-text-primary">有什么我可以帮你的？</div>
                  <div className="mt-2 text-sm text-text-muted">支持 simple 与 thinking 两种模式</div>
                </div>
                <ChatInput
                  mode={mode}
                  onModeChange={setMode}
                  onSend={send}
                  showSuggestions
                />
              </div>
            ) : (
              <div className="flex size-full flex-col">
                <div className="flex-1 min-h-0">
                  <MessageList messages={messages} isStreaming={isStreaming} isWaiting={isWaiting} />
                </div>
                <div className="sticky bottom-0 z-10 w-full bg-gradient-to-t from-surface-alt via-surface-alt/95 to-transparent pt-4 pb-5">
                  <div className="mx-auto w-full max-w-3xl px-4 md:px-2">
                    <ChatInput
                      mode={mode}
                      onModeChange={setMode}
                      onSend={send}
                      showSuggestions={false}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
}
