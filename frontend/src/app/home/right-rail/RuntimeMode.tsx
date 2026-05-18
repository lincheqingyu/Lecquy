// 中文：本文件（RuntimeMode.tsx）位于 frontend/src/app/home/right-rail/RuntimeMode.tsx，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (RuntimeMode.tsx) belongs to the frontend frontend 模块实现 layer in frontend/src/app/home/right-rail/RuntimeMode.tsx, wiring upstream callers with downstream runtime logic.

import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import { createDefaultThinkingConfig, type ThinkingConfig, type ThinkingProtocol } from '@lecquy/shared'
import type { ModelConfig } from '../../../hooks/useChat'
import { API_V1 } from '../../../config/api'
import {
  getModelPresetLabel,
  getModelPresetModelLabel,
  NEW_MODEL_PRESET_VALUE,
  type ModelPresetItem,
} from '../../../lib/model-presets'
import {
  fetchContextFiles,
  fetchMemoryFiles,
  fetchMemoryRuntimeConfig,
  saveMemoryRuntimeConfig,
  updateContextFile,
  type ContextFileName,
  type ContextFileRecord,
  type MemoryFileMeta,
  type MemoryRuntimeConfig,
} from '../../../lib/context-api'
import { RightRailCard, RightRailListItem } from './RightRailPrimitives'

interface RuntimeModeProps {
  isActive: boolean
  modelConfig: ModelConfig
  onModelConfigChange: (config: ModelConfig) => void
  modelPresets: ModelPresetItem[]
  selectedModelPresetId: string
  onModelPresetsChange: Dispatch<SetStateAction<ModelPresetItem[]>>
  onSelectedModelPresetIdChange: Dispatch<SetStateAction<string>>
}

type InlineDropdownId = 'agentPreset' | 'maxTokens' | 'thinkingProtocol' | 'thinkingLevel' | 'cacheRetention'
type EditableContextFileName = Extract<ContextFileName, 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.md'>
type ManagedContextFileName = Extract<ContextFileName, 'AGENTS.md' | 'TOOLS.md'>
type KernelContextFileName = EditableContextFileName | ManagedContextFileName

const EMPTY_CONTEXT_FILES: Record<ContextFileName, ContextFileRecord | undefined> = {
  'SOUL.md': undefined,
  'IDENTITY.md': undefined,
  'USER.md': undefined,
  'MEMORY.md': undefined,
  'AGENTS.md': undefined,
  'TOOLS.md': undefined,
}

const EDITABLE_CONTEXT_FILE_NAMES = new Set<ContextFileName>([
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
])

const KERNEL_CONTEXT_FILES: ReadonlyArray<{
  name: KernelContextFileName
  description: string
}> = [
  { name: 'SOUL.md', description: '人格底色与稳定价值取向' },
  { name: 'IDENTITY.md', description: '使命与能力边界' },
  { name: 'USER.md', description: 'kira 稳定画像' },
  { name: 'MEMORY.md', description: '长期记忆维护入口' },
  { name: 'AGENTS.md', description: '项目级 Agent 规则' },
  { name: 'TOOLS.md', description: '工具纪律' },
]

const tokenOptions = [
  { key: 'low', label: 'low', hint: '8k', value: 8192 },
  { key: 'medium', label: 'medium', hint: '16k', value: 16384 },
  { key: 'high', label: 'high', hint: '32k', value: 32768 },
  { key: 'xhigh', label: 'xhigh', hint: '64k', value: 65536 },
] as const

const cacheRetentionOptions = [
  { value: 'none', label: 'none' },
  { value: 'short', label: 'short' },
  { value: 'long', label: 'long' },
] as const satisfies ReadonlyArray<{ value: ModelConfig['cacheRetention']; label: string }>

const thinkingProtocolOptions = [
  { value: 'off', label: 'off' },
  { value: 'qwen', label: 'qwen' },
  { value: 'zai', label: 'zai' },
  { value: 'openai_reasoning', label: 'openai' },
] as const satisfies ReadonlyArray<{ value: ThinkingProtocol; label: string }>

const thinkingLevelOptions = [
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
] as const satisfies ReadonlyArray<{ value: ThinkingConfig['level']; label: string }>

function isEditableContextFile(name: KernelContextFileName | null): name is EditableContextFileName {
  return Boolean(name && EDITABLE_CONTEXT_FILE_NAMES.has(name))
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

function RuntimeTextInput({
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  align = 'right',
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  align?: 'left' | 'right'
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className={clsx(
        'w-36 border-b border-border bg-transparent py-1.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-text-primary',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    />
  )
}

function RuntimeTextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="min-h-24 w-full resize-y rounded-lg border border-border/60 bg-transparent px-2.5 py-2 text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-text-primary"
    />
  )
}

function RuntimeSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2 border-t border-border/50 pt-3 first:border-t-0 first:pt-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {title}
      </div>
      {children}
    </section>
  )
}

function RuntimeToggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-[color:var(--color-toggle-on)]' : 'bg-[color:var(--color-toggle-off)]',
        disabled && 'cursor-not-allowed',
      )}
    >
      <span
        className={clsx(
          'inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-transform',
          checked
            ? 'translate-x-[1.15rem] bg-[color:var(--color-toggle-thumb-active)]'
            : 'translate-x-0.5 bg-[color:var(--color-toggle-thumb)]',
        )}
      />
    </button>
  )
}

function RuntimeInlineDropdown({
  id,
  label,
  value,
  hint,
  widthClassName = 'w-32',
  isOpen,
  onToggle,
  dropdownRef,
  children,
}: {
  id: InlineDropdownId
  label: string
  value: string
  hint?: string
  widthClassName?: string
  isOpen: boolean
  onToggle: (id: InlineDropdownId) => void
  dropdownRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  return (
    <div ref={dropdownRef} className={clsx('relative', widthClassName)}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex h-8 w-full items-center justify-end gap-1.5 rounded-md border border-border/60 bg-transparent px-2 text-sm text-text-primary outline-none transition-colors hover:bg-hover/50 focus-visible:border-text-muted"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
      >
        <span className="min-w-0 truncate">{value}</span>
        {hint && <span className="shrink-0 text-xs text-text-muted">{hint}</span>}
        <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 z-20 mt-1.5 max-h-60 w-full overflow-auto rounded-lg border border-border/70 bg-surface p-1 shadow-[0_14px_34px_rgba(15,23,42,0.12)] dark:border-white/[0.08]"
          role="listbox"
          aria-label={`${label} options`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function DropdownOption({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-hover text-text-primary'
          : 'text-text-secondary hover:bg-hover/70 hover:text-text-primary',
      )}
      role="option"
      aria-selected={active}
    >
      {children}
    </button>
  )
}

function RuntimeAccordionRow({
  label,
  detail,
  expanded,
  onClick,
  children,
}: {
  label: string
  detail?: string
  expanded: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-sm text-text-primary outline-none focus-visible:text-text-primary"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-text-muted" />
          )}
          <span className="truncate">{label}</span>
        </span>
        {detail && <span className="min-w-0 shrink truncate text-xs text-text-muted">{detail}</span>}
      </button>
      <div
        className={clsx(
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pl-3 pt-2">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function RuntimeMode({
  isActive,
  modelConfig,
  onModelConfigChange,
  modelPresets,
  selectedModelPresetId,
  onModelPresetsChange: setModelPresets,
  onSelectedModelPresetIdChange: setSelectedModelPresetId,
}: RuntimeModeProps) {
  const [activeInlineDropdown, setActiveInlineDropdown] = useState<InlineDropdownId | null>(null)
  const [expandedRoleFiles, setExpandedRoleFiles] = useState<string[]>([])
  const [activeKernelFile, setActiveKernelFile] = useState<KernelContextFileName | null>(null)
  const [contextFiles, setContextFiles] =
    useState<Record<ContextFileName, ContextFileRecord | undefined>>(EMPTY_CONTEXT_FILES)
  const [contextDrafts, setContextDrafts] = useState<Record<EditableContextFileName, string>>({
    'SOUL.md': '',
    'IDENTITY.md': '',
    'USER.md': '',
    'MEMORY.md': '',
  })
  const [contextSaveStatus, setContextSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState('')
  const [draftAgentName, setDraftAgentName] = useState('')
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [draftApiKey, setDraftApiKey] = useState('')
  const [headersDraft, setHeadersDraft] = useState('{}')
  const [metadataDraft, setMetadataDraft] = useState('{}')
  const [advancedConfigError, setAdvancedConfigError] = useState<string | null>(null)
  const [modelSaveStatus, setModelSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [memoryDraftConfig, setMemoryDraftConfig] =
    useState<MemoryRuntimeConfig>({ flushTurns: 20, embeddingBaseUrl: '' })
  const [memoryFiles, setMemoryFiles] = useState<MemoryFileMeta[]>([])
  const [memorySaveStatus, setMemorySaveStatus] = useState<'Saved' | 'Editing'>('Saved')
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [isLogsExpanded, setIsLogsExpanded] = useState(false)
  const fetchAbortRef = useRef<AbortController | null>(null)
  const runtimeScrollRef = useRef<HTMLDivElement | null>(null)
  const agentPresetDropdownRef = useRef<HTMLDivElement | null>(null)
  const maxTokensDropdownRef = useRef<HTMLDivElement | null>(null)
  const thinkingProtocolDropdownRef = useRef<HTMLDivElement | null>(null)
  const thinkingLevelDropdownRef = useRef<HTMLDivElement | null>(null)
  const cacheRetentionDropdownRef = useRef<HTMLDivElement | null>(null)
  const thinkingConfig = modelConfig.thinking ?? createDefaultThinkingConfig()

  const activeModelPreset = modelPresets.find((item) => item.id === selectedModelPresetId) ?? null
  const activeAgentRoleFiles = activeModelPreset?.roleContextFiles?.length
    ? activeModelPreset.roleContextFiles
    : ['Role.md', 'Tools.md']
  const maxTokenPreset = modelConfig.maxTokens <= 8192
    ? 'low'
    : modelConfig.maxTokens <= 16384
      ? 'medium'
      : modelConfig.maxTokens <= 32768
        ? 'high'
        : 'xhigh'
  const selectedTokenOption =
    tokenOptions.find((item) => item.key === maxTokenPreset) ?? tokenOptions[0]
  const selectedThinkingProtocol =
    thinkingProtocolOptions.find((item) => item.value === thinkingConfig.protocol) ?? thinkingProtocolOptions[0]
  const selectedThinkingLevel =
    thinkingLevelOptions.find((item) => item.value === thinkingConfig.level) ?? thinkingLevelOptions[3]
  const selectedCacheRetention =
    cacheRetentionOptions.find((item) => item.value === modelConfig.cacheRetention) ?? cacheRetentionOptions[1]
  const thinkingProtocolSelected = thinkingConfig.protocol !== 'off'
  const thinkingEnabled = thinkingProtocolSelected && thinkingConfig.enabled
  const selectedPresetLabel = selectedModelPresetId === NEW_MODEL_PRESET_VALUE
    ? 'untitled'
    : getModelPresetLabel(activeModelPreset) || 'untitled'

  const updateModelConfig = useCallback((partial: Partial<ModelConfig>) => {
    onModelConfigChange({ ...modelConfig, ...partial })
  }, [modelConfig, onModelConfigChange])

  const updateThinkingConfig = useCallback((partial: Partial<ThinkingConfig>) => {
    updateModelConfig({
      thinking: {
        ...thinkingConfig,
        ...partial,
      },
    })
  }, [thinkingConfig, updateModelConfig])

  const updateJsonRuntimeConfig = useCallback((
    key: 'headers' | 'metadata',
    value: string,
  ) => {
    if (key === 'headers') {
      setHeadersDraft(value)
    } else {
      setMetadataDraft(value)
    }

    try {
      const parsed = JSON.parse(value || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('必须是 JSON object')
      }

      if (key === 'headers') {
        const invalidKey = Object.entries(parsed as Record<string, unknown>)
          .find(([, item]) => typeof item !== 'string')?.[0]
        if (invalidKey) throw new Error(`headers.${invalidKey} 必须是 string`)
        updateModelConfig({ headers: parsed as Record<string, string> })
      } else {
        updateModelConfig({ metadata: parsed as Record<string, unknown> })
      }
      setAdvancedConfigError(null)
    } catch (error) {
      setAdvancedConfigError(error instanceof Error ? error.message : 'JSON 解析失败')
    }
  }, [updateModelConfig])

  const closeDropdown = useCallback(() => {
    setActiveInlineDropdown(null)
  }, [])

  const toggleInlineDropdown = useCallback((dropdownId: InlineDropdownId) => {
    setActiveInlineDropdown((current) => current === dropdownId ? null : dropdownId)
  }, [])

  const resetTransientState = useCallback(() => {
    setActiveInlineDropdown(null)
    setExpandedRoleFiles([])
    setActiveKernelFile(null)
    setContextError(null)
    setModelsError(null)
    setMemoryError(null)
    setAdvancedConfigError(null)
    setIsLogsExpanded(false)
  }, [])

  const fetchModelName = useCallback(async (baseUrl: string, apiKey: string, signal: AbortSignal) => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const response = await fetch(`${API_V1}/models/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
        signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `请求失败: ${response.status}`)
      }
      const json = await response.json() as { success: boolean; data?: { data?: Array<{ id: string }> } }
      const modelId = json?.data?.data?.[0]?.id
      if (!modelId) throw new Error('未找到可用模型')
      return modelId
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setModelsError(error instanceof Error ? error.message : '获取模型失败')
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const handleFetchModelIfNeeded = useCallback(async () => {
    if (draftModel.trim() || !draftBaseUrl.trim()) return
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    const modelId = await fetchModelName(draftBaseUrl.trim(), draftApiKey.trim(), controller.signal)
    if (!modelId) return
    setDraftModel(modelId)
    setModelSaveStatus('Editing')
  }, [draftApiKey, draftBaseUrl, draftModel, fetchModelName])

  const persistContextFile = useCallback(async (name: EditableContextFileName, content: string) => {
    try {
      const file = await updateContextFile(name, content)
      setContextFiles((prev) => ({ ...prev, [name]: file }))
      setContextDrafts((prev) => ({ ...prev, [name]: file.content }))
      setContextSaveStatus('Saved')
      setContextError(null)
    } catch (error) {
      setContextError(error instanceof Error ? error.message : '保存上下文失败')
    }
  }, [])

  const flushActiveKernelDraft = useCallback(() => {
    if (contextSaveStatus !== 'Editing' || !isEditableContextFile(activeKernelFile)) return
    void persistContextFile(activeKernelFile, contextDrafts[activeKernelFile])
  }, [activeKernelFile, contextDrafts, contextSaveStatus, persistContextFile])

  const handleKernelToggle = (name: KernelContextFileName) => {
    if (activeKernelFile === name) {
      flushActiveKernelDraft()
      setActiveKernelFile(null)
      return
    }
    flushActiveKernelDraft()
    setActiveKernelFile(name)
    setContextError(null)
    setContextSaveStatus('Saved')
  }

  const handleModelPresetSelection = (value: string) => {
    setSelectedModelPresetId(value)
    closeDropdown()
    if (value === NEW_MODEL_PRESET_VALUE) {
      setDraftAgentName('')
      setDraftModel('')
      setDraftBaseUrl('')
      setDraftApiKey('')
      setHeadersDraft('{}')
      setMetadataDraft('{}')
      setAdvancedConfigError(null)
      setModelSaveStatus('Saved')
      setModelsError(null)
      return
    }

    const selected = modelPresets.find((item) => item.id === value)
    setDraftAgentName(selected?.title ?? selected?.model ?? '')
    setDraftModel(selected?.model ?? '')
    setDraftBaseUrl(selected?.baseUrl ?? '')
    setDraftApiKey(selected?.apiKey ?? '')
    setHeadersDraft(JSON.stringify(selected?.headers ?? {}, null, 2))
    setMetadataDraft(JSON.stringify(selected?.metadata ?? {}, null, 2))
    setAdvancedConfigError(null)
    if (selected) {
      const defaultThinking = createDefaultThinkingConfig()
      onModelConfigChange({
        model: selected.model,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        temperature: Number(selected.temperature ?? 0.7),
        maxTokens: Number(selected.maxTokens ?? 8192),
        enableTools: Boolean(selected.enableTools ?? false),
        thinking: {
          ...defaultThinking,
          ...selected.thinking,
        },
        headers: selected.headers ?? {},
        cacheRetention: selected.cacheRetention ?? 'short',
        sessionId: selected.sessionId ?? '',
        maxRetryDelayMs: Number(selected.maxRetryDelayMs ?? 60000),
        metadata: selected.metadata ?? {},
      })
    }
    setModelSaveStatus('Saved')
    setModelsError(null)
  }

  const handleCreateAgent = () => {
    setSelectedModelPresetId(NEW_MODEL_PRESET_VALUE)
    setDraftAgentName('')
    setDraftModel('')
    setDraftBaseUrl('')
    setDraftApiKey('')
    setHeadersDraft('{}')
    setMetadataDraft('{}')
    setAdvancedConfigError(null)
    setModelSaveStatus('Saved')
    setModelsError(null)
    closeDropdown()
  }

  const handleDeleteModelPreset = () => {
    if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) return
    const nextItems = modelPresets.filter((item) => item.id !== selectedModelPresetId)
    const fallback = nextItems[0] ?? null
    setModelPresets(nextItems)
    setSelectedModelPresetId(fallback?.id ?? NEW_MODEL_PRESET_VALUE)
    setDraftAgentName(fallback?.title ?? fallback?.model ?? '')
    setDraftModel(fallback?.model ?? '')
    setDraftBaseUrl(fallback?.baseUrl ?? '')
    setDraftApiKey(fallback?.apiKey ?? '')
    setHeadersDraft(JSON.stringify(fallback?.headers ?? {}, null, 2))
    setMetadataDraft(JSON.stringify(fallback?.metadata ?? {}, null, 2))
    setAdvancedConfigError(null)
    if (fallback) {
      const defaultThinking = createDefaultThinkingConfig()
      onModelConfigChange({
        model: fallback.model,
        baseUrl: fallback.baseUrl,
        apiKey: fallback.apiKey,
        temperature: Number(fallback.temperature ?? 0.7),
        maxTokens: Number(fallback.maxTokens ?? 8192),
        enableTools: Boolean(fallback.enableTools ?? false),
        thinking: {
          ...defaultThinking,
          ...fallback.thinking,
        },
        headers: fallback.headers ?? {},
        cacheRetention: fallback.cacheRetention ?? 'short',
        sessionId: fallback.sessionId ?? '',
        maxRetryDelayMs: Number(fallback.maxRetryDelayMs ?? 60000),
        metadata: fallback.metadata ?? {},
      })
    }
    setModelSaveStatus('Saved')
    setModelsError(null)
  }

  const handleRoleToggle = (file: string) => {
    setExpandedRoleFiles((current) => (
      current.includes(file)
        ? current.filter((item) => item !== file)
        : [...current, file]
    ))
  }

  const getRoleFileContent = (file: string): string => {
    const normalized = file.trim().toLowerCase()
    if (normalized === 'tools.md') {
      return contextFiles['TOOLS.md']?.content || 'TOOLS.md 尚未加载。'
    }
    if (normalized === 'role.md') {
      return [
        '# Role.md',
        '',
        `Name: ${draftAgentName.trim() || selectedPresetLabel}`,
        `Model: ${draftModel.trim() || 'not configured'}`,
        `Base URL: ${draftBaseUrl.trim() || 'not configured'}`,
        `Tools: ${modelConfig.enableTools ? 'enabled' : 'disabled'}`,
        `Reasoning: ${thinkingConfig.protocol === 'off' ? 'off' : `${thinkingConfig.protocol} · ${thinkingConfig.level}`}`,
        '',
        `Role context files: ${activeAgentRoleFiles.join(', ')}`,
      ].join('\n')
    }
    return `# ${file}\n\n当前 agent 仅保存该 roleContextFiles 引用。`
  }

  useEffect(() => {
    if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
      setDraftAgentName('')
      setDraftModel('')
      setDraftBaseUrl('')
      setDraftApiKey('')
      setHeadersDraft(JSON.stringify(modelConfig.headers, null, 2))
      setMetadataDraft(JSON.stringify(modelConfig.metadata, null, 2))
    } else {
      setDraftAgentName(activeModelPreset?.title ?? activeModelPreset?.model ?? '')
      setDraftModel(activeModelPreset?.model ?? '')
      setDraftBaseUrl(activeModelPreset?.baseUrl ?? '')
      setDraftApiKey(activeModelPreset?.apiKey ?? '')
      setHeadersDraft(JSON.stringify(activeModelPreset?.headers ?? {}, null, 2))
      setMetadataDraft(JSON.stringify(activeModelPreset?.metadata ?? {}, null, 2))
    }
    setModelSaveStatus('Saved')
    setModelsError(null)
    setAdvancedConfigError(null)
  }, [
    activeModelPreset?.apiKey,
    activeModelPreset?.baseUrl,
    activeModelPreset?.headers,
    activeModelPreset?.metadata,
    activeModelPreset?.model,
    activeModelPreset?.title,
    modelConfig.headers,
    modelConfig.metadata,
    selectedModelPresetId,
  ])

  useEffect(() => {
    if (!isActive) return
    void (async () => {
      setContextLoading(true)
      setContextError(null)
      setMemoryError(null)
      try {
        const [files, memoryConfig, logs] = await Promise.all([
          fetchContextFiles(),
          fetchMemoryRuntimeConfig(),
          fetchMemoryFiles(),
        ])
        const nextFiles = files.reduce<Record<ContextFileName, ContextFileRecord | undefined>>(
          (acc, file) => ({ ...acc, [file.name]: file }),
          { ...EMPTY_CONTEXT_FILES },
        )
        setContextFiles(nextFiles)
        setContextDrafts({
          'SOUL.md': nextFiles['SOUL.md']?.content ?? '',
          'IDENTITY.md': nextFiles['IDENTITY.md']?.content ?? '',
          'USER.md': nextFiles['USER.md']?.content ?? '',
          'MEMORY.md': nextFiles['MEMORY.md']?.content ?? '',
        })
        setMemoryDraftConfig(memoryConfig)
        setMemoryFiles(logs)
        setContextSaveStatus('Saved')
        setMemorySaveStatus('Saved')
      } catch (error) {
        setContextError(error instanceof Error ? error.message : '加载上下文失败')
      } finally {
        setContextLoading(false)
      }
    })()
  }, [isActive])

  useEffect(() => {
    if (isActive) return
    resetTransientState()
  }, [isActive, resetTransientState])

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (modelSaveStatus !== 'Editing') return

    const timer = window.setTimeout(() => {
      if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
        if (!draftAgentName.trim() && !draftModel.trim() && !draftBaseUrl.trim() && !draftApiKey.trim()) {
          setModelSaveStatus('Saved')
          return
        }
        const nextId = `model_${Date.now()}`
        const newItem: ModelPresetItem = {
          id: nextId,
          model: draftModel,
          baseUrl: draftBaseUrl,
          apiKey: draftApiKey,
          title: draftAgentName.trim() || draftModel.trim() || 'Untitled agent',
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
          enableTools: modelConfig.enableTools,
          thinking: modelConfig.thinking,
          headers: modelConfig.headers,
          cacheRetention: modelConfig.cacheRetention,
          sessionId: modelConfig.sessionId,
          maxRetryDelayMs: modelConfig.maxRetryDelayMs,
          metadata: modelConfig.metadata,
          roleContextFiles: ['Role.md', 'Tools.md'],
        }
        setModelPresets((prev) => [...prev, newItem])
        setSelectedModelPresetId(nextId)
        onModelConfigChange({
          ...modelConfig,
          model: newItem.model,
          baseUrl: newItem.baseUrl,
          apiKey: newItem.apiKey,
        })
        setModelSaveStatus('Saved')
        return
      }

      setModelPresets((prev) => prev.map((item) => (
        item.id === selectedModelPresetId
          ? {
              ...item,
              model: draftModel,
              baseUrl: draftBaseUrl,
              apiKey: draftApiKey,
              title: draftAgentName.trim() || draftModel.trim() || item.title,
              temperature: modelConfig.temperature,
              maxTokens: modelConfig.maxTokens,
              enableTools: modelConfig.enableTools,
              thinking: modelConfig.thinking,
              headers: modelConfig.headers,
              cacheRetention: modelConfig.cacheRetention,
              sessionId: modelConfig.sessionId,
              maxRetryDelayMs: modelConfig.maxRetryDelayMs,
              metadata: modelConfig.metadata,
              roleContextFiles: item.roleContextFiles ?? ['Role.md', 'Tools.md'],
            }
          : item
      )))
      onModelConfigChange({
        ...modelConfig,
        model: draftModel,
        baseUrl: draftBaseUrl,
        apiKey: draftApiKey,
      })
      setModelSaveStatus('Saved')
    }, 250)

    return () => window.clearTimeout(timer)
  }, [
    draftAgentName,
    draftApiKey,
    draftBaseUrl,
    draftModel,
    modelConfig,
    modelSaveStatus,
    onModelConfigChange,
    selectedModelPresetId,
    setModelPresets,
    setSelectedModelPresetId,
  ])

  useEffect(() => {
    if (contextSaveStatus !== 'Editing' || !isEditableContextFile(activeKernelFile)) return

    const timer = window.setTimeout(() => {
      void persistContextFile(activeKernelFile, contextDrafts[activeKernelFile])
    }, 250)

    return () => window.clearTimeout(timer)
  }, [activeKernelFile, contextDrafts, contextSaveStatus, persistContextFile])

  useEffect(() => {
    if (memorySaveStatus !== 'Editing') return

    const timer = window.setTimeout(async () => {
      try {
        const next = await saveMemoryRuntimeConfig(memoryDraftConfig)
        setMemoryDraftConfig(next)
        setMemorySaveStatus('Saved')
        setMemoryError(null)
      } catch (error) {
        setMemoryError(error instanceof Error ? error.message : '保存记忆配置失败')
      }
    }, 250)

    return () => window.clearTimeout(timer)
  }, [memoryDraftConfig, memorySaveStatus])

  useEffect(() => {
    if (!activeInlineDropdown) return

    const dropdownRefs = [
      agentPresetDropdownRef,
      maxTokensDropdownRef,
      thinkingProtocolDropdownRef,
      thinkingLevelDropdownRef,
      cacheRetentionDropdownRef,
    ]

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (dropdownRefs.some((ref) => ref.current?.contains(target))) return
      closeDropdown()
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [activeInlineDropdown, closeDropdown])

  useEffect(() => {
    if (!isActive || !activeInlineDropdown) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeDropdown()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeInlineDropdown, closeDropdown, isActive])

  useEffect(() => {
    if (!activeInlineDropdown) return

    const node = runtimeScrollRef.current
    if (!node) return
    node.addEventListener('scroll', closeDropdown, { passive: true })
    return () => node.removeEventListener('scroll', closeDropdown)
  }, [activeInlineDropdown, closeDropdown])

  return (
    <div ref={runtimeScrollRef} className="settings-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pb-5">
      <div className="space-y-2.5">
        <RightRailCard title="Agent Runtime">
          <RuntimeSection title="Model">
          <RightRailListItem label="Preset">
            <div className="flex items-center justify-end gap-1.5">
              <RuntimeInlineDropdown
                id="agentPreset"
                label="Agent preset"
                value={selectedPresetLabel}
                widthClassName="w-36"
                isOpen={activeInlineDropdown === 'agentPreset'}
                onToggle={toggleInlineDropdown}
                dropdownRef={agentPresetDropdownRef}
              >
                <DropdownOption
                  active={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                  onClick={() => handleModelPresetSelection(NEW_MODEL_PRESET_VALUE)}
                >
                  <span className="truncate">untitled</span>
                </DropdownOption>
                {modelPresets.map((item) => (
                  <DropdownOption
                    key={item.id}
                    active={selectedModelPresetId === item.id}
                    onClick={() => handleModelPresetSelection(item.id)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{getModelPresetLabel(item)}</span>
                      <span className="truncate text-xs text-text-muted">
                        {getModelPresetModelLabel(item)}
                      </span>
                    </span>
                  </DropdownOption>
                ))}
              </RuntimeInlineDropdown>
              <button
                type="button"
                onClick={handleCreateAgent}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                aria-label="新增 agent"
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleDeleteModelPreset}
                disabled={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="删除当前 agent"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </RightRailListItem>
          <RightRailListItem label="Name">
            <RuntimeTextInput
              value={draftAgentName}
              onChange={(value) => {
                setDraftAgentName(value)
                setModelSaveStatus('Editing')
              }}
              placeholder="Untitled agent"
            />
          </RightRailListItem>
          <RightRailListItem label="Model">
            <RuntimeTextInput
              value={draftModel}
              onChange={(value) => {
                setDraftModel(value)
                setModelSaveStatus('Editing')
                setModelsError(null)
              }}
              placeholder="model name"
            />
          </RightRailListItem>
          <RightRailListItem label="Base URL">
            <RuntimeTextInput
              value={draftBaseUrl}
              onChange={(value) => {
                setDraftBaseUrl(value)
                setModelSaveStatus('Editing')
                setModelsError(null)
              }}
              onBlur={() => void handleFetchModelIfNeeded()}
              placeholder="http://127.0.0.1:8000/v1"
            />
          </RightRailListItem>
          <RightRailListItem label="API Key">
            <RuntimeTextInput
              type="password"
              value={draftApiKey}
              onChange={(value) => {
                setDraftApiKey(value)
                setModelSaveStatus('Editing')
                setModelsError(null)
              }}
              placeholder="optional"
            />
          </RightRailListItem>
          {modelsLoading && (
            <div className="py-1 text-xs text-text-muted">正在读取模型列表...</div>
          )}
          {modelsError && (
            <div className="py-1 text-xs text-red-600">{modelsError}</div>
          )}
          </RuntimeSection>

          <RuntimeSection title="Sampling">
          <div className="py-2">
            <div className="mb-2 flex items-center justify-between gap-4">
              <span className="text-sm text-text-primary">Temperature</span>
              <span className="text-sm tabular-nums text-text-primary">
                {modelConfig.temperature.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={modelConfig.temperature}
              onChange={(event) => updateModelConfig({ temperature: Number(event.target.value) })}
              className="w-full accent-text-primary"
            />
          </div>
          <RightRailListItem label="Max tokens">
            <RuntimeInlineDropdown
              id="maxTokens"
              label="Max tokens"
              value={selectedTokenOption.label}
              hint={selectedTokenOption.hint}
              isOpen={activeInlineDropdown === 'maxTokens'}
              onToggle={toggleInlineDropdown}
              dropdownRef={maxTokensDropdownRef}
            >
              {tokenOptions.map((item) => (
                <DropdownOption
                  key={item.key}
                  active={item.key === maxTokenPreset}
                  onClick={() => {
                    updateModelConfig({ maxTokens: item.value })
                    closeDropdown()
                  }}
                >
                  <span>{item.label}</span>
                  <span className="text-xs text-text-muted">{item.hint}</span>
                </DropdownOption>
              ))}
            </RuntimeInlineDropdown>
          </RightRailListItem>
          </RuntimeSection>

          <RuntimeSection title="Tools">
          <RightRailListItem label="Function calling" description="启用后 agent 可调用工具。">
            <RuntimeToggle
              checked={modelConfig.enableTools}
              onChange={() => updateModelConfig({ enableTools: !modelConfig.enableTools })}
              label="切换 Function calling"
            />
          </RightRailListItem>
          </RuntimeSection>

          <RuntimeSection title="Reasoning">
          <RightRailListItem label="Enabled" muted={!thinkingProtocolSelected}>
            <RuntimeToggle
              checked={thinkingEnabled}
              disabled={!thinkingProtocolSelected}
              onChange={() => updateThinkingConfig({ enabled: !thinkingConfig.enabled })}
              label="切换 reasoning"
            />
          </RightRailListItem>
          <RightRailListItem label="Protocol">
            <RuntimeInlineDropdown
              id="thinkingProtocol"
              label="Reasoning protocol"
              value={selectedThinkingProtocol.label}
              isOpen={activeInlineDropdown === 'thinkingProtocol'}
              onToggle={toggleInlineDropdown}
              dropdownRef={thinkingProtocolDropdownRef}
            >
              {thinkingProtocolOptions.map((item) => (
                <DropdownOption
                  key={item.value}
                  active={item.value === thinkingConfig.protocol}
                  onClick={() => {
                    updateThinkingConfig({
                      protocol: item.value,
                      enabled: item.value === 'off' ? false : thinkingConfig.enabled,
                    })
                    closeDropdown()
                  }}
                >
                  <span>{item.label}</span>
                </DropdownOption>
              ))}
            </RuntimeInlineDropdown>
          </RightRailListItem>
          <RightRailListItem label="Level" muted={!thinkingProtocolSelected}>
            <RuntimeInlineDropdown
              id="thinkingLevel"
              label="Reasoning level"
              value={selectedThinkingLevel.label}
              isOpen={activeInlineDropdown === 'thinkingLevel'}
              onToggle={toggleInlineDropdown}
              dropdownRef={thinkingLevelDropdownRef}
            >
              {thinkingLevelOptions.map((item) => (
                <DropdownOption
                  key={item.value}
                  active={item.value === thinkingConfig.level}
                  onClick={() => {
                    updateThinkingConfig({ level: item.value })
                    closeDropdown()
                  }}
                >
                  <span>{item.label}</span>
                </DropdownOption>
              ))}
            </RuntimeInlineDropdown>
          </RightRailListItem>
          </RuntimeSection>

          <RuntimeSection title="Advanced">
            <RightRailListItem label="Cache">
              <RuntimeInlineDropdown
                id="cacheRetention"
                label="Cache retention"
                value={selectedCacheRetention.label}
                isOpen={activeInlineDropdown === 'cacheRetention'}
                onToggle={toggleInlineDropdown}
                dropdownRef={cacheRetentionDropdownRef}
              >
                {cacheRetentionOptions.map((item) => (
                  <DropdownOption
                    key={item.value}
                    active={item.value === modelConfig.cacheRetention}
                    onClick={() => {
                      updateModelConfig({ cacheRetention: item.value })
                      closeDropdown()
                    }}
                  >
                    <span>{item.label}</span>
                  </DropdownOption>
                ))}
              </RuntimeInlineDropdown>
            </RightRailListItem>
            <RightRailListItem label="Session ID">
              <RuntimeTextInput
                value={modelConfig.sessionId}
                onChange={(value) => updateModelConfig({ sessionId: value })}
                placeholder="optional"
              />
            </RightRailListItem>
            <RightRailListItem label="Retry cap">
              <RuntimeTextInput
                type="number"
                value={String(modelConfig.maxRetryDelayMs)}
                onChange={(value) => updateModelConfig({ maxRetryDelayMs: Number(value || 0) })}
                placeholder="60000"
              />
            </RightRailListItem>
            <div className="space-y-1.5 py-1">
              <div className="text-xs text-text-muted">Headers JSON</div>
              <RuntimeTextArea
                value={headersDraft}
                onChange={(value) => updateJsonRuntimeConfig('headers', value)}
                placeholder='{"x-provider": "lecquy"}'
              />
            </div>
            <div className="space-y-1.5 py-1">
              <div className="text-xs text-text-muted">Metadata JSON</div>
              <RuntimeTextArea
                value={metadataDraft}
                onChange={(value) => updateJsonRuntimeConfig('metadata', value)}
                placeholder='{"user_id": "kira"}'
              />
            </div>
            {advancedConfigError && (
              <div className="py-1 text-xs text-red-600">{advancedConfigError}</div>
            )}
          </RuntimeSection>
        </RightRailCard>

        <RightRailCard title="Role Context">
          {activeAgentRoleFiles.map((file) => {
            const expanded = expandedRoleFiles.includes(file)
            return (
              <RuntimeAccordionRow
                key={file}
                label={file}
                expanded={expanded}
                onClick={() => handleRoleToggle(file)}
              >
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-l border-border pl-3 text-xs leading-6 text-text-secondary">
                  {getRoleFileContent(file)}
                </pre>
              </RuntimeAccordionRow>
            )
          })}
        </RightRailCard>

        <RightRailCard title="Kernel">
          {contextLoading && (
            <div className="py-2 text-sm text-text-secondary">正在加载上下文文件...</div>
          )}
          {contextError && (
            <div className="py-1 text-xs text-red-600">{contextError}</div>
          )}
          {KERNEL_CONTEXT_FILES.map((file) => {
            const expanded = activeKernelFile === file.name
            return (
              <RuntimeAccordionRow
                key={file.name}
                label={file.name}
                detail={file.description}
                expanded={expanded}
                onClick={() => handleKernelToggle(file.name)}
              >
                {isEditableContextFile(file.name) ? (
                  <textarea
                    value={contextDrafts[file.name]}
                    onChange={(event) => {
                      setContextDrafts((prev) => ({
                        ...prev,
                        [file.name]: event.target.value,
                      }))
                      setContextSaveStatus('Editing')
                      setContextError(null)
                    }}
                    className="min-h-64 w-full resize-y border-l border-border bg-transparent pl-3 text-sm leading-6 text-text-primary outline-none"
                    spellCheck
                  />
                ) : (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-l border-border pl-3 text-xs leading-6 text-text-primary">
                    {contextFiles[file.name]?.content || '(empty)'}
                  </pre>
                )}
                <div className="mt-2 text-[11px] text-text-muted">
                  <code>{contextFiles[file.name]?.path ?? `.lecquy/${file.name}`}</code>
                </div>
              </RuntimeAccordionRow>
            )
          })}
        </RightRailCard>

        <RightRailCard title="Memory Runtime">
          <RightRailListItem label="Embedding URL">
            <RuntimeTextInput
              value={memoryDraftConfig.embeddingBaseUrl}
              onChange={(value) => {
                setMemoryDraftConfig((prev) => ({ ...prev, embeddingBaseUrl: value }))
                setMemorySaveStatus('Editing')
                setMemoryError(null)
              }}
              placeholder="http://127.0.0.1:8000/v1"
            />
          </RightRailListItem>
          <RightRailListItem label="Flush turns">
            <RuntimeTextInput
              type="number"
              value={String(memoryDraftConfig.flushTurns)}
              onChange={(value) => {
                setMemoryDraftConfig((prev) => ({
                  ...prev,
                  flushTurns: Number(value || 1),
                }))
                setMemorySaveStatus('Editing')
                setMemoryError(null)
              }}
              placeholder="20"
            />
          </RightRailListItem>
          <RightRailListItem label="memory.db">
            <span className="text-sm text-text-secondary">SQLite · local</span>
          </RightRailListItem>
          <RuntimeAccordionRow
            label={`Logs (read-only · ${memoryFiles.length} files)`}
            expanded={isLogsExpanded}
            onClick={() => setIsLogsExpanded((current) => !current)}
          >
            <div className="max-h-56 overflow-auto border-l border-border pl-3">
              {memoryFiles.length === 0 ? (
                <div className="py-2 text-xs text-text-muted">No logs</div>
              ) : (
                memoryFiles.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between gap-3 py-1.5 text-xs text-text-secondary"
                  >
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0 text-[11px] text-text-muted">
                      {formatBytes(file.size)} · {formatDate(file.updatedAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </RuntimeAccordionRow>
          {memoryError && (
            <div className="py-1 text-xs text-red-600">{memoryError}</div>
          )}
          <div className="mt-3 border-l border-amber-600 pl-3 text-xs leading-5 text-amber-600">
            衰减机制待实现，详见 CLAUDE.md §8.1
          </div>
        </RightRailCard>
      </div>
    </div>
  )
}
