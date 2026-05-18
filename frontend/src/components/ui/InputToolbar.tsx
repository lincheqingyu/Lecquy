// 中文：本文件（InputToolbar.tsx）位于 frontend/src/components/ui/InputToolbar.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (InputToolbar.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/ui/InputToolbar.tsx, wiring upstream callers with downstream runtime logic.

import clsx from 'clsx'
import { ArrowUp, Plus } from 'lucide-react'

interface InputToolbarProps {
  /** 输入框是否有内容（控制发送按钮状态） */
  hasContent: boolean
  /** 当前模式 */
  mode: 'simple' | 'plan'
  /** 切换模式 */
  onModeChange: (mode: 'simple' | 'plan') => void
  /** 点击附件/加号按钮 */
  onPlusClick: () => void
  /** 点击发送按钮 */
  onSend: () => void
}

/**
 * 输入框底部工具栏
 *
 * 左侧：圆形加号按钮（附件入口）
 * 右侧：发送按钮（有内容时高亮，无内容时禁用态）
 */
export function InputToolbar({
  hasContent,
  mode,
  onModeChange,
  onPlusClick,
  onSend,
}: InputToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 pb-3">
      {/* 左侧：加号按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlusClick}
          className={clsx(
            'flex items-center justify-center',
            'size-8 rounded-full',
            'border border-border',
            'text-text-secondary',
            'transition-colors hover:bg-toolbar-selected hover:text-text-primary',
          )}
          aria-label="添加附件"
        >
          <Plus className="size-4" />
        </button>

        {mode === 'plan' && (
          <button
            type="button"
            onClick={() => onModeChange('simple')}
            className="rounded-full border border-border bg-toolbar-selected px-2 py-1 text-xs text-text-primary"
            aria-label="关闭 plan 模式"
          >
            plan
          </button>
        )}
      </div>

      {/* 右侧：发送按钮 */}
      <button
        type="button"
        onClick={onSend}
        disabled={!hasContent}
        className={clsx(
          'flex items-center justify-center',
          'size-8 rounded-full',
          'transition-colors',
          hasContent
            ? 'bg-accent text-white hover:opacity-90'
            : 'bg-toolbar-selected text-text-muted cursor-not-allowed',
        )}
        aria-label="发送消息"
      >
        <ArrowUp className="size-4" />
      </button>
    </div>
  )
}
