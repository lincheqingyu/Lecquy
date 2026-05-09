import clsx from 'clsx'
import { ChevronDown, FileText, Folder, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import { CategoryTags } from './CategoryTags'
import type { ChatMode, ModelConfig } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl, readChatAttachment } from '../../lib/chat-attachments'
import { getModelPresetLabel, type ModelPresetItem } from '../../lib/model-presets'

const FILE_INPUT_ACCEPT = 'image/*,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.sql,.yaml,.yml,.xml,.html,.css,.scss,.log,.pdf,.docx,.xlsx,.xls'

export interface ChatInputSubmitPayload {
  message: string
  attachments: ChatAttachment[]
}

interface ChatInputProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (payload: ChatInputSubmitPayload) => void
  modelConfig: ModelConfig
  modelPresets: ModelPresetItem[]
  selectedModelPresetId: string
  onModelPresetSelect: (presetId: string) => void
  showSuggestions?: boolean
  disabled?: boolean
  disabledReason?: string | null
  rightSlot?: ReactNode
}

function inferFallbackExtension(file: File): string {
  if (file.type.startsWith('image/')) {
    const subtype = file.type.split('/')[1]
    return subtype === 'jpeg' ? 'jpg' : (subtype || 'png')
  }

  if (file.type.includes('pdf')) return 'pdf'
  if (file.type.includes('json')) return 'json'
  if (file.type.includes('markdown')) return 'md'
  if (file.type.startsWith('text/')) return 'txt'
  return 'bin'
}

function normalizeIncomingFile(file: File, index: number): File {
  if (file.name) return file

  const extension = inferFallbackExtension(file)
  const prefix = file.type.startsWith('image/') ? 'pasted-image' : 'pasted-file'
  return new File([file], `${prefix}-${Date.now()}-${index}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

/**
 * 聊天输入框编排组件
 *
 * 管理输入状态，组合 AutoResizeTextarea + 轻量工具栏 + CategoryTags。
 * 容器采用 Claude / Codex 风格的单体圆角输入卡，避免额外底部阴影层。
 *
 * 关键设计：textarea 独占文本区，工具按钮固定在底部工具栏中，
 * multiline 状态不会反向改变 textarea 的横向可用宽度。
 */
export function ChatInput({
  mode,
  onModeChange,
  onSend,
  modelConfig,
  modelPresets,
  selectedModelPresetId,
  onModelPresetSelect,
  showSuggestions = true,
  disabled = false,
  disabledReason = null,
  rightSlot,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isReadingAttachments, setIsReadingAttachments] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const previewAttachments = useMemo(() => attachments.map((attachment) => ({
    attachment,
    previewUrl: buildAttachmentPreviewUrl(attachment),
  })), [attachments])
  const activeModelPreset = useMemo(() => {
    return modelPresets.find((preset) => preset.id === selectedModelPresetId) ?? null
  }, [modelPresets, selectedModelPresetId])
  const modelButtonLabel = getModelPresetLabel(activeModelPreset) || modelConfig.model || '选择模型'

  /** 发送消息（暂时为空操作，后续接入） */
  const handleSend = () => {
    if (disabled || (!message.trim() && attachments.length === 0)) return
    onSend({
      message,
      attachments,
    })
    setMessage('')
    setAttachments([])
    setAttachmentError(null)
  }

  const handlePlusClick = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const appendFiles = async (files: File[]) => {
    if (files.length === 0) return

    setIsReadingAttachments(true)
    setAttachmentError(null)

    try {
      const normalizedFiles = files.map((file, index) => normalizeIncomingFile(file, index))
      const parsed = await Promise.all(normalizedFiles.map((file) => readChatAttachment(file)))
      setAttachments((prev) => [...prev, ...parsed])
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '读取附件失败')
    } finally {
      setIsReadingAttachments(false)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (nextFiles.length === 0) return
    await appendFiles(nextFiles)
    // 系统文件对话框关闭后焦点离开了 textarea，需要主动送回；
    // 粘贴 / 拖拽路径下 textarea 不会被 unmount，焦点天然保持，无需任何额外处理。
    if (!disabled) textareaRef.current?.focus()
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isReadingAttachments) return

    const clipboardFiles = Array.from(event.clipboardData.files ?? [])
    const itemFiles = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    const files = clipboardFiles.length > 0 ? clipboardFiles : itemFiles
    if (files.length === 0) return

    event.preventDefault()
    void appendFiles(files)
  }

  /** 点击分类标签（暂时填入输入框，后续接入） */
  const handleCategorySelect = (label: string) => {
    // TODO: 接入分类逻辑
    setMessage(label)
  }

  const toggleThinking = () => {
    onModeChange(mode === 'plan' ? 'simple' : 'plan')
  }

  const handleModelSelect = (presetId: string) => {
    onModelPresetSelect(presetId)
    setIsModelMenuOpen(false)
  }

  const planBadge = mode === 'plan' ? (
    <button
      type="button"
      onClick={() => onModeChange('simple')}
      className="inline-flex h-8 shrink-0 items-center rounded-full border border-[color:var(--color-input-border)] bg-toolbar-selected px-3 text-sm font-medium text-[color:var(--color-input-control)] transition-colors hover:bg-toolbar-selected"
      aria-label="关闭 plan 模式"
    >
      Plan
    </button>
  ) : null

  useEffect(() => {
    if (!isModelMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (modelMenuRef.current?.contains(target)) return
      setIsModelMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isModelMenuOpen])

  return (
    <div className="mx-auto w-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
      <div
        className={clsx(
          'relative rounded-[24px] border border-[color:var(--color-input-border)] bg-input-surface shadow-[var(--shadow-input)]',
          'transition-[border-color,box-shadow] duration-150',
          !disabled && 'hover:border-[color:var(--color-input-border-hover)] focus-within:border-[color:var(--color-input-border-hover)] focus-within:shadow-[var(--shadow-input-hover)]',
        )}
      >
        {/* 第一段：附件预览区（仅在有附件时渲染，单独子树不影响主输入行结构） */}
        {attachments.length > 0 && (
          <div className="px-5 pt-5">
            <div className="flex flex-wrap gap-2">
              {previewAttachments.map(({ attachment, previewUrl }, index) => (
                attachment.kind === 'image' ? (
                  <div
                    key={`${attachment.name}_${index}`}
                    className="group relative h-20 w-20 overflow-hidden rounded-2xl border border-border bg-surface-thought"
                  >
                    <img
                      src={previewUrl ?? ''}
                      alt={attachment.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(index)}
                      className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-surface/90 text-text-primary backdrop-blur transition-colors hover:bg-surface dark:text-white"
                      aria-label={`移除附件 ${attachment.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2 py-1 text-[11px] text-white">
                      <div className="truncate">{attachment.name}</div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={`${attachment.name}_${index}`}
                    className="group relative flex min-w-[11rem] max-w-[15rem] items-start gap-3 rounded-2xl border border-border bg-surface-thought px-3 py-2.5"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-text-secondary">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-text-primary">{attachment.name}</div>
                      <div className="mt-0.5 text-xs text-text-secondary">
                        {(attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : '文本文件')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(index)}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-hover hover:text-text-primary dark:text-white"
                      aria-label={`移除附件 ${attachment.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* 第二段：文本区 —— textarea 独占宽度，工具栏不会影响换行测量 */}
        <div className={attachments.length > 0 ? 'px-5 pt-4' : 'px-5 pt-4'}>
          <AutoResizeTextarea
            key="textarea"
            value={message}
            onChange={setMessage}
            onSend={handleSend}
            placeholder="要在 Lecquy 中构建什么？"
            onToggleThinking={toggleThinking}
            onPaste={handlePaste}
            textareaRef={textareaRef}
            maxRows={10}
            className="max-h-[16rem] min-h-7 px-0 py-0 text-[18px] leading-7 placeholder:text-[color:var(--color-input-placeholder)]"
            disabled={disabled}
          />
        </div>

        {/* 第三段：轻量工具栏 —— 只提供附件、假文件夹与 preset 选择，不放发送按钮 */}
        <div className="flex min-h-12 items-center gap-3 px-4 pb-3">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePlusClick}
              className={clsx(
                'flex size-8 shrink-0 items-center justify-center rounded-full',
                'text-[color:var(--color-input-control)] transition-colors hover:bg-toolbar-selected',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              aria-label={isReadingAttachments ? '正在读取附件' : '添加附件'}
              title={isReadingAttachments ? '正在读取附件' : '添加附件'}
              disabled={disabled || isReadingAttachments}
            >
              <Plus className="size-5" strokeWidth={1.8} />
            </button>

            <button
              type="button"
              className="inline-flex h-8 min-w-0 items-center gap-2 rounded-full px-2.5 text-[15px] font-medium text-[color:var(--color-input-control)] transition-colors hover:bg-toolbar-selected"
              aria-label="当前文件夹 Lecquy"
              title="当前文件夹 Lecquy"
            >
              <Folder className="size-4 shrink-0" strokeWidth={1.8} />
              <span className="max-w-[8rem] truncate">Lecquy</span>
              <ChevronDown className="size-4 shrink-0 text-[color:var(--color-input-control-muted)]" strokeWidth={1.8} />
            </button>

            {planBadge}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div ref={modelMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsModelMenuOpen((prev) => !prev)}
                className="inline-flex h-8 w-max items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[15px] font-medium text-[color:var(--color-input-control)] transition-colors hover:bg-toolbar-selected"
                aria-haspopup="listbox"
                aria-expanded={isModelMenuOpen}
                aria-label={`选择模型：${modelButtonLabel}`}
                title={modelButtonLabel}
              >
                <span>{modelButtonLabel}</span>
                <ChevronDown className="size-4 shrink-0" strokeWidth={1.8} />
              </button>

              {isModelMenuOpen && (
                <div
                  className="absolute bottom-full right-0 z-30 mb-2 w-[min(18rem,calc(100vw-2rem))] max-h-[13rem] overflow-y-auto rounded-2xl border border-border bg-surface-raised p-1 shadow-[0_18px_48px_rgba(15,23,42,0.14)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.42)]"
                  role="listbox"
                  aria-label="模型 preset"
                >
                  {modelPresets.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-text-muted">
                      请先在设置栏 Model 卡片中添加模型
                    </div>
                  ) : (
                    modelPresets.map((preset) => {
                      const selected = preset.id === selectedModelPresetId
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleModelSelect(preset.id)}
                          className={clsx(
                            'flex w-full flex-col rounded-xl px-3 py-2.5 text-left transition-colors',
                            selected
                              ? 'bg-toolbar-selected text-text-primary'
                              : 'text-text-secondary hover:bg-toolbar-selected hover:text-text-primary',
                          )}
                          role="option"
                          aria-selected={selected}
                        >
                          <span className="max-w-full truncate text-sm font-medium">
                            {getModelPresetLabel(preset)}
                          </span>
                          <span className="mt-0.5 max-w-full truncate text-xs text-text-muted">
                            {preset.baseUrl || 'No base URL'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {rightSlot && <div className="shrink-0">{rightSlot}</div>}
          </div>
        </div>
      </div>

      {attachmentError && (
        <div className="mt-2 text-center text-xs text-rose-500">
          {attachmentError}
        </div>
      )}

      {disabledReason && (
        <div className="mt-2 text-center text-xs text-text-muted">
          {disabledReason}
        </div>
      )}

      {/* 分类标签（输入框下方） */}
      {showSuggestions && <CategoryTags onSelect={handleCategorySelect} />}
    </div>
  )
}
