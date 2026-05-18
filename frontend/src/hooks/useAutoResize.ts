// 中文：本文件（useAutoResize.ts）位于 frontend/src/hooks/useAutoResize.ts，属于frontend链路中的前端状态钩子代码，连接上游调用方与下游执行逻辑。
// English: This file (useAutoResize.ts) belongs to the frontend 前端状态钩子 layer in frontend/src/hooks/useAutoResize.ts, wiring upstream callers with downstream runtime logic.

import { useCallback, useLayoutEffect, useRef } from 'react'

interface AutoResizeLayoutState {
  multiline: boolean
  overflowing: boolean
}

/**
 * textarea 自动高度调整 Hook
 *
 * 监听 value 变化，自动调整 textarea 高度。
 * 超过 maxRows 行时启用滚动。
 *
 * @param value - 当前文本内容
 * @param maxRows - 最大可见行数（默认 8）
 */
export function useAutoResize(
  value: string,
  maxRows = 8,
  onLayoutChange?: (state: AutoResizeLayoutState) => void,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onLayoutChangeRef = useRef(onLayoutChange)
  const lastLayoutRef = useRef<AutoResizeLayoutState | null>(null)

  useLayoutEffect(() => {
    onLayoutChangeRef.current = onLayoutChange
  }, [onLayoutChange])

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 获取行高（从 computed style 解析）
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
    const maxHeight = lineHeight * maxRows

    // 先收缩到一行，再用 scrollHeight 算出实际内容高度
    el.style.height = 'auto'
    const style = getComputedStyle(el)
    const paddingTop = parseFloat(style.paddingTop) || 0
    const paddingBottom = parseFloat(style.paddingBottom) || 0
    const singleLineHeight = lineHeight + paddingTop + paddingBottom

    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(scrollHeight, maxHeight)

    el.style.height = `${nextHeight}px`
    const overflowing = scrollHeight > maxHeight
    el.style.overflowY = overflowing ? 'auto' : 'hidden'

    const multilineThreshold = singleLineHeight + lineHeight / 2
    const multiline = value.trim().length > 0 && scrollHeight > multilineThreshold
    const nextLayout = { multiline, overflowing }
    const lastLayout = lastLayoutRef.current

    if (
      !lastLayout
      || lastLayout.multiline !== nextLayout.multiline
      || lastLayout.overflowing !== nextLayout.overflowing
    ) {
      lastLayoutRef.current = nextLayout
      onLayoutChangeRef.current?.(nextLayout)
    }
  }, [maxRows, value])

  useLayoutEffect(() => {
    resize()
  }, [resize])

  return textareaRef
}
