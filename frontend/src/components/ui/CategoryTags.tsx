import clsx from 'clsx'
import { Code, Coffee, GraduationCap, PenLine, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'

/** 分类标签配置 */
interface CategoryItem {
  label: string
  icon: ComponentType<{ className?: string }>
}

const CATEGORIES: CategoryItem[] = [
  { label: '学习', icon: GraduationCap },
  { label: '写作', icon: PenLine },
  { label: '编程', icon: Code },
  { label: '生活', icon: Coffee },
  { label: '随便聊聊', icon: Sparkles },
]

interface CategoryTagsProps {
  /** 点击标签回调 */
  onSelect: (label: string) => void
}

/**
 * 分类标签列表
 *
 * 展示 5 个预设分类，点击后可快速设定对话主题。
 * 每个标签配有 lucide-react 图标，hover 时变色。
 */
export function CategoryTags({ onSelect }: CategoryTagsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-4 pt-2">
      {CATEGORIES.map(({ label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(label)}
          className={clsx(
            'flex items-center gap-1.5',
            'rounded-lg border border-border bg-surface',
            'px-3 py-1.5 text-sm',
            'text-text-secondary',
            'transition-colors',
            'hover:bg-accent-soft hover:text-accent-text hover:border-accent-text/20',
          )}
        >
          <Icon className="size-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
