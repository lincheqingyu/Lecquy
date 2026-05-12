import {
    Bot,
    Brain,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Cpu,
    Database,
    FileText,
    Pencil,
    Plus,
    SlidersHorizontal,
    Trash2,
    Wrench,
    X,
} from 'lucide-react'
import {clsx} from 'clsx'
import {useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react'
import {createDefaultThinkingConfig, type ThinkingConfig, type ThinkingProtocol} from '@lecquy/shared'
import type {ModelConfig} from '../../../hooks/useChat'
import {API_V1} from '../../../config/api.ts'
import {
    getModelPresetLabel,
    getModelPresetModelLabel,
    NEW_MODEL_PRESET_VALUE,
    type ModelPresetItem,
} from '../../../lib/model-presets.ts'
import {
    fetchContextFiles,
    fetchMemoryFileContent,
    fetchMemoryFiles,
    fetchMemoryRuntimeConfig,
    saveMemoryRuntimeConfig,
    updateContextFile,
    type ContextFileName,
    type ContextFileRecord,
    type MemoryFileMeta,
    type MemoryRuntimeConfig,
} from '../../../lib/context-api.ts'

/**
 * SettingsDrawer 的 Props
 *
 */
interface SettingsDrawerProps {
    isOpen: boolean
    onClose: () => void
    modelConfig: ModelConfig
    onModelConfigChange: (config: ModelConfig) => void
    modelPresets: ModelPresetItem[]
    selectedModelPresetId: string
    onModelPresetsChange: Dispatch<SetStateAction<ModelPresetItem[]>>
    onSelectedModelPresetIdChange: Dispatch<SetStateAction<string>>
}

type InlineDropdownId = 'maxTokens' | 'thinkingProtocol' | 'thinkingLevel'
type EditableContextFileName = Extract<ContextFileName, 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.md'>
type ManagedContextFileName = Extract<ContextFileName, 'AGENTS.md' | 'TOOLS.md'>

const EDITABLE_CONTEXT_FILES: ReadonlyArray<{
    name: EditableContextFileName
    title: string
    summary: string
}> = [
    {name: 'SOUL.md', title: 'Soul', summary: '助手气质与表达风格'},
    {name: 'IDENTITY.md', title: 'Identity', summary: '角色定位与能力边界'},
    {name: 'USER.md', title: 'User', summary: '用户背景、偏好与约定'},
    {name: 'MEMORY.md', title: 'Memory', summary: '长期记忆与运行配置'},
] as const
const MANAGED_CONTEXT_FILES: ReadonlyArray<{name: ManagedContextFileName; title: string}> = [
    {name: 'AGENTS.md', title: 'AGENTS.md'},
    {name: 'TOOLS.md', title: 'TOOLS.md'},
] as const

/**
 * 设置抽屉
 *
 * 动画原理：
 * → 抽屉始终在 DOM 中（不会被销毁/创建）
 * → 作为 flex 兄弟元素参与主布局，宽度在 0 ↔ 20rem 之间动画
 * → 关闭时宽度坍缩到 0，主对话区占满顶栏下 100% 宽
 * → 打开时挤占主对话区的右侧空间，滚动条自然落在主对话区与设置区交界
 * → 内层使用固定 w-[20rem]，配合外层 overflow-hidden，避免动画期间内容回流抖动
 */
export function SettingsDrawer({
                                   isOpen,
                                   onClose,
                                   modelConfig,
                                   onModelConfigChange,
                                   modelPresets,
                                   selectedModelPresetId,
                                   onModelPresetsChange: setModelPresets,
                                   onSelectedModelPresetIdChange: setSelectedModelPresetId,
                               }: SettingsDrawerProps) {
    const [isContextPanelOpen, setIsContextPanelOpen] = useState(false)
    const [isModelOptionsOpen, setIsModelOptionsOpen] = useState(false)
    const [isCurrentAgentExpanded, setIsCurrentAgentExpanded] = useState(false)
    const [isLecquyKernelExpanded, setIsLecquyKernelExpanded] = useState(false)
    const [activeInlineDropdown, setActiveInlineDropdown] = useState<InlineDropdownId | null>(null)
    const [isModelPanelOpen, setIsModelPanelOpen] = useState(false)
    const [selectedContextFile, setSelectedContextFile] = useState<EditableContextFileName>('SOUL.md')
    const [selectedManagedFile, setSelectedManagedFile] = useState<ManagedContextFileName | null>(null)
    const [contextFiles, setContextFiles] = useState<Record<ContextFileName, ContextFileRecord | undefined>>({
        'SOUL.md': undefined,
        'IDENTITY.md': undefined,
        'USER.md': undefined,
        'MEMORY.md': undefined,
        'AGENTS.md': undefined,
        'TOOLS.md': undefined,
    })
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
    const [modelSaveStatus, setModelSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const fetchAbortRef = useRef<AbortController | null>(null)
    const settingsScrollRef = useRef<HTMLDivElement | null>(null)
    const maxTokensDropdownRef = useRef<HTMLDivElement | null>(null)
    const thinkingProtocolDropdownRef = useRef<HTMLDivElement | null>(null)
    const thinkingLevelDropdownRef = useRef<HTMLDivElement | null>(null)
    const [memoryConfig, setMemoryConfig] = useState<MemoryRuntimeConfig>({flushTurns: 20, embeddingBaseUrl: ''})
    const [memoryDraftConfig, setMemoryDraftConfig] = useState<MemoryRuntimeConfig>({flushTurns: 20, embeddingBaseUrl: ''})
    const [memoryFiles, setMemoryFiles] = useState<MemoryFileMeta[]>([])
    const [selectedMemoryFile, setSelectedMemoryFile] = useState<string | null>(null)
    const [selectedMemoryContent, setSelectedMemoryContent] = useState('')
    const [memorySaveStatus, setMemorySaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const thinkingConfig = modelConfig.thinking ?? createDefaultThinkingConfig()

    const resetDrawerPanels = useCallback(() => {
        setIsContextPanelOpen(false)
        setIsModelPanelOpen(false)
        setIsModelOptionsOpen(false)
        setActiveInlineDropdown(null)
        setSelectedContextFile('SOUL.md')
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setContextError(null)
    }, [])

    const updateModelConfig = (partial: Partial<ModelConfig>) => {
        onModelConfigChange({...modelConfig, ...partial})
    }

    const updateThinkingConfig = (partial: Partial<ThinkingConfig>) => {
        updateModelConfig({
            thinking: {
                ...thinkingConfig,
                ...partial,
            },
        })
    }

    /** 从 vLLM /v1/models 接口获取模型名称 */
    const fetchModelName = useCallback(async (baseUrl: string, apiKey: string, signal: AbortSignal) => {
        setModelsLoading(true)
        setModelsError(null)
        try {
            const response = await fetch(`${API_V1}/models/list`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({baseUrl, apiKey: apiKey || undefined}),
                signal,
            })
            if (!response.ok) {
                const text = await response.text().catch(() => '')
                throw new Error(text || `请求失败: ${response.status}`)
            }
            const json = await response.json() as { success: boolean; data?: { data?: Array<{ id: string }> } }
            const modelId = json?.data?.data?.[0]?.id
            if (!modelId) {
                throw new Error('未找到可用模型')
            }
            return modelId
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const msg = error instanceof Error ? error.message : '获取模型失败'
            setModelsError(msg)
        } finally {
            setModelsLoading(false)
        }
    }, [])

    const handleConnectModel = useCallback(async () => {
        if (!draftBaseUrl.trim()) {
            setModelsError('请先填写 Base URL')
            return
        }

        fetchAbortRef.current?.abort()
        const controller = new AbortController()
        fetchAbortRef.current = controller
        const modelId = await fetchModelName(draftBaseUrl.trim(), draftApiKey.trim(), controller.signal)
        if (!modelId) return

        setDraftModel(modelId)
        setModelSaveStatus('Editing')
        setModelsError(null)
    }, [draftApiKey, draftBaseUrl, fetchModelName])

    useEffect(() => {
        return () => {
            fetchAbortRef.current?.abort()
        }
    }, [])

    const maxTokenPreset = (() => {
        if (modelConfig.maxTokens <= 8192) return 'low'
        if (modelConfig.maxTokens <= 16384) return 'medium'
        return 'high'
    })()

    const activeModelPreset = modelPresets.find((p) => p.id === selectedModelPresetId) ?? null
    const activeAgentName = getModelPresetLabel(activeModelPreset) || modelConfig.model || 'Default agent'
    const activeAgentModel = getModelPresetModelLabel(activeModelPreset) || modelConfig.model || 'No model configured'
    const activeAgentRoleFiles = activeModelPreset?.roleContextFiles?.length
        ? activeModelPreset.roleContextFiles
        : ['Role.md', 'Tools.md']
    const tokenOptions = [
        {key: 'low', label: 'Low', hint: '8k', value: 8192},
        {key: 'medium', label: 'Middle', hint: '16k', value: 16384},
        {key: 'high', label: 'High', hint: '32k', value: 32768},
    ] as const
    const thinkingProtocolOptions = [
        {value: 'off', label: 'Off'},
        {value: 'qwen', label: 'Qwen'},
        {value: 'zai', label: 'Z.ai'},
        {value: 'openai_reasoning', label: 'OpenAI'},
    ] as const satisfies ReadonlyArray<{value: ThinkingProtocol; label: string}>
    const thinkingLevelOptions = [
        {value: 'off', label: 'Off'},
        {value: 'minimal', label: 'Minimal'},
        {value: 'low', label: 'Low'},
        {value: 'medium', label: 'Medium'},
        {value: 'high', label: 'High'},
        {value: 'xhigh', label: 'XHigh'},
    ] as const satisfies ReadonlyArray<{value: ThinkingConfig['level']; label: string}>
    const selectedTokenOption =
        tokenOptions.find((item) => item.key === maxTokenPreset) ?? tokenOptions[0]
    const selectedThinkingProtocol =
        thinkingProtocolOptions.find((item) => item.value === thinkingConfig.protocol) ?? thinkingProtocolOptions[0]
    const selectedThinkingLevel =
        thinkingLevelOptions.find((item) => item.value === thinkingConfig.level) ?? thinkingLevelOptions[3]
    const thinkingProtocolSelected = thinkingConfig.protocol !== 'off'
    const thinkingEnabled = thinkingProtocolSelected && thinkingConfig.enabled
    const isMaxTokensOpen = activeInlineDropdown === 'maxTokens'
    const isThinkingProtocolOpen = activeInlineDropdown === 'thinkingProtocol'
    const isThinkingLevelOpen = activeInlineDropdown === 'thinkingLevel'

    const toggleInlineDropdown = (dropdownId: InlineDropdownId) => {
        setActiveInlineDropdown((current) => current === dropdownId ? null : dropdownId)
    }

    useEffect(() => {
        if (!isModelPanelOpen) return
        const initialId = selectedModelPresetId ?? NEW_MODEL_PRESET_VALUE
        setSelectedModelPresetId(initialId)
        if (initialId === NEW_MODEL_PRESET_VALUE) {
            setDraftAgentName('')
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
        } else {
            const selected = modelPresets.find((p) => p.id === initialId)
            setDraftAgentName(selected?.title ?? selected?.model ?? '')
            setDraftModel(selected?.model ?? '')
            setDraftBaseUrl(selected?.baseUrl ?? '')
            setDraftApiKey(selected?.apiKey ?? '')
        }
        setModelSaveStatus('Saved')
        setModelsError(null)
    }, [isModelPanelOpen, modelPresets, selectedModelPresetId, setSelectedModelPresetId])

    useEffect(() => {
        if (!isContextPanelOpen) return
        void (async () => {
            setContextLoading(true)
            setContextError(null)
            try {
                const [files, cfg, logs] = await Promise.all([
                    fetchContextFiles(),
                    fetchMemoryRuntimeConfig(),
                    fetchMemoryFiles(),
                ])
                const nextMap = files.reduce<Record<ContextFileName, ContextFileRecord | undefined>>((acc, file) => {
                    acc[file.name] = file
                    return acc
                }, {
                    'SOUL.md': undefined,
                    'IDENTITY.md': undefined,
                    'USER.md': undefined,
                    'MEMORY.md': undefined,
                    'AGENTS.md': undefined,
                    'TOOLS.md': undefined,
                })

                setContextFiles(nextMap)
                setContextDrafts({
                    'SOUL.md': nextMap['SOUL.md']?.content ?? '',
                    'IDENTITY.md': nextMap['IDENTITY.md']?.content ?? '',
                    'USER.md': nextMap['USER.md']?.content ?? '',
                    'MEMORY.md': nextMap['MEMORY.md']?.content ?? '',
                })
                setMemoryConfig(cfg)
                setMemoryDraftConfig(cfg)
                setMemoryFiles(logs)
                setSelectedMemoryFile(null)
                setSelectedMemoryContent('')
                setContextSaveStatus('Saved')
                setMemorySaveStatus('Saved')
            } catch (error) {
                setContextError(error instanceof Error ? error.message : '加载上下文失败')
            } finally {
                setContextLoading(false)
            }
        })()
    }, [isContextPanelOpen])

    useEffect(() => {
        if (isOpen) return
        resetDrawerPanels()
    }, [isOpen, resetDrawerPanels])

    useEffect(() => {
        if (!isModelPanelOpen || modelSaveStatus !== 'Editing') return

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

            const nextItems = modelPresets.map((item) =>
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
                        roleContextFiles: item.roleContextFiles ?? ['Role.md', 'Tools.md'],
                    }
                    : item,
            )
            setModelPresets(nextItems)
            onModelConfigChange({
                ...modelConfig,
                model: draftModel,
                baseUrl: draftBaseUrl,
                apiKey: draftApiKey,
            })
            setModelSaveStatus('Saved')
        }, 250)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        draftAgentName,
        draftApiKey,
        draftBaseUrl,
        draftModel,
        isModelPanelOpen,
        modelConfig,
        modelPresets,
        modelSaveStatus,
        onModelConfigChange,
        selectedModelPresetId,
        setModelPresets,
        setSelectedModelPresetId,
    ])

    useEffect(() => {
        if (!isContextPanelOpen || selectedContextFile !== 'MEMORY.md' || memorySaveStatus !== 'Editing') return

        const timer = window.setTimeout(async () => {
            try {
                const next = await saveMemoryRuntimeConfig(memoryDraftConfig)
                setMemoryConfig(next)
                setMemoryDraftConfig(next)
                setMemorySaveStatus('Saved')
            } catch (error) {
                setContextError(error instanceof Error ? error.message : '保存记忆配置失败')
            }
        }, 250)

        return () => window.clearTimeout(timer)
    }, [isContextPanelOpen, memoryDraftConfig, memorySaveStatus, selectedContextFile])

    useEffect(() => {
        if (!activeInlineDropdown) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return

            if (
                maxTokensDropdownRef.current?.contains(target)
                || thinkingProtocolDropdownRef.current?.contains(target)
                || thinkingLevelDropdownRef.current?.contains(target)
            ) {
                return
            }

            setActiveInlineDropdown(null)
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setActiveInlineDropdown(null)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [activeInlineDropdown])

    useEffect(() => {
        if (!activeInlineDropdown) return

        const node = settingsScrollRef.current
        if (!node) return

        const handleScroll = () => {
            setActiveInlineDropdown(null)
        }

        node.addEventListener('scroll', handleScroll, {passive: true})
        return () => node.removeEventListener('scroll', handleScroll)
    }, [activeInlineDropdown])

    useEffect(() => {
        if (!isOpen || isContextPanelOpen || isModelPanelOpen) {
            setActiveInlineDropdown(null)
        }
    }, [isContextPanelOpen, isModelPanelOpen, isOpen])

    const persistContextFile = useCallback(async (name: EditableContextFileName, content: string) => {
        try {
            const file = await updateContextFile(name, content)
            setContextFiles((prev) => ({...prev, [name]: file}))
            setContextDrafts((prev) => ({...prev, [name]: file.content}))
            setContextSaveStatus('Saved')
            setContextError(null)
        } catch (error) {
            setContextError(error instanceof Error ? error.message : '保存上下文失败')
        }
    }, [])

    useEffect(() => {
        if (!isContextPanelOpen || contextSaveStatus !== 'Editing') return
        const draft = contextDrafts[selectedContextFile]
        const timer = window.setTimeout(() => {
            void persistContextFile(selectedContextFile, draft)
        }, 250)

        return () => window.clearTimeout(timer)
    }, [contextDrafts, contextSaveStatus, isContextPanelOpen, persistContextFile, selectedContextFile])

    const handleModelPresetSelection = (value: string) => {
        setSelectedModelPresetId(value)
        if (value === NEW_MODEL_PRESET_VALUE) {
            setDraftAgentName('')
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
            setModelSaveStatus('Saved')
            setModelsError(null)
            return
        }
        const selected = modelPresets.find((item) => item.id === value)
        setDraftAgentName(selected?.title ?? selected?.model ?? '')
        setDraftModel(selected?.model ?? '')
        setDraftBaseUrl(selected?.baseUrl ?? '')
        setDraftApiKey(selected?.apiKey ?? '')
        if (selected) {
            const defaultThinking = createDefaultThinkingConfig()
            onModelConfigChange({
                ...modelConfig,
                model: selected.model,
                baseUrl: selected.baseUrl,
                apiKey: selected.apiKey,
                temperature: Number(selected.temperature ?? modelConfig.temperature),
                maxTokens: Number(selected.maxTokens ?? modelConfig.maxTokens),
                enableTools: Boolean(selected.enableTools ?? modelConfig.enableTools),
                thinking: {
                    ...defaultThinking,
                    ...modelConfig.thinking,
                    ...selected.thinking,
                },
            })
        }
        setModelSaveStatus('Saved')
        setModelsError(null)
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
        if (fallback) {
            const defaultThinking = createDefaultThinkingConfig()
            onModelConfigChange({
                ...modelConfig,
                model: fallback.model,
                baseUrl: fallback.baseUrl,
                apiKey: fallback.apiKey,
                temperature: Number(fallback.temperature ?? modelConfig.temperature),
                maxTokens: Number(fallback.maxTokens ?? modelConfig.maxTokens),
                enableTools: Boolean(fallback.enableTools ?? modelConfig.enableTools),
                thinking: {
                    ...defaultThinking,
                    ...modelConfig.thinking,
                    ...fallback.thinking,
                },
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
        setModelSaveStatus('Saved')
        setModelsError(null)
        setIsModelPanelOpen(true)
    }

    const handleEditAgent = () => {
        setIsModelPanelOpen(true)
    }

    const handleOpenContextPanel = (name: EditableContextFileName) => {
        setSelectedContextFile(name)
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setIsContextPanelOpen(true)
    }

    const handleCloseContextPanel = () => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setIsContextPanelOpen(false)
    }

    const handleSelectContextFile = (name: EditableContextFileName) => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setSelectedContextFile(name)
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setContextSaveStatus('Saved')
        setContextError(null)
    }

    const handleSelectManagedFile = (name: ManagedContextFileName) => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setSelectedManagedFile(name)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
    }

    const handleOpenMemoryFile = async (name: string) => {
        try {
            const content = await fetchMemoryFileContent(name)
            setSelectedMemoryFile(name)
            setSelectedMemoryContent(content)
        } catch (error) {
            setContextError(error instanceof Error ? error.message : '读取记忆文件失败')
        }
    }

    const handleDrawerClose = useCallback(() => {
        if (isContextPanelOpen && contextSaveStatus === 'Editing' && !selectedManagedFile) {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        resetDrawerPanels()
        onClose()
    }, [
        contextDrafts,
        contextSaveStatus,
        isContextPanelOpen,
        onClose,
        persistContextFile,
        resetDrawerPanels,
        selectedContextFile,
        selectedManagedFile,
    ])

    useEffect(() => {
        if (!isOpen) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleDrawerClose()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, handleDrawerClose])

    const hasSecondaryPanelOpen = isContextPanelOpen || isModelPanelOpen
    const hasActiveAgent = selectedModelPresetId !== NEW_MODEL_PRESET_VALUE && Boolean(activeModelPreset)
    const railCardClassName = 'rounded-2xl border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]'
    const railIconButtonClassName = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40'
    const kernelFiles = [
        {name: 'SOUL.md', label: 'Soul'},
        {name: 'IDENTITY.md', label: 'Identity'},
        {name: 'USER.md', label: 'User'},
        {name: 'MEMORY.md', label: 'Memory'},
    ] as const satisfies ReadonlyArray<{name: EditableContextFileName; label: string}>

    return (
        <div
            className={clsx(
                "shrink-0 overflow-hidden bg-surface-alt",
                "transition-[width] duration-300 ease-in-out",
            )}
            style={{width: isOpen ? '22.5rem' : '0'}}
            role="complementary"
            aria-label="设置辅助栏"
            aria-hidden={!isOpen}
            inert={!isOpen}
        >
            {/* 内层固定宽度，避免外层宽度动画过程中内容回流抖动 */}
            <div className="flex h-full w-[22.5rem] flex-col">
                    <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                    ref={settingsScrollRef}
                    className={clsx(
                        "settings-scrollbar-hidden h-full overflow-y-auto px-4 py-4",
                        hasSecondaryPanelOpen && "pointer-events-none invisible",
                    )}
                    style={{
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 20px, black 100%)',
                        maskImage: 'linear-gradient(to bottom, transparent 0, black 20px, black 100%)',
                    }}
                    aria-hidden={hasSecondaryPanelOpen}
                >
                    <div className="space-y-3">
                        <section className={railCardClassName} aria-label="Current agent">
                            <button
                                type="button"
                                onClick={() => setIsCurrentAgentExpanded(!isCurrentAgentExpanded)}
                                className="flex w-full items-center justify-between gap-3 text-left"
                            >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <Bot className="size-5 shrink-0 text-text-primary" strokeWidth={1.8}/>
                                    <h3 className="truncate text-[18px] font-semibold leading-6 text-text-primary">Current agent</h3>
                                    <span className="truncate text-sm text-text-secondary">{activeAgentName}</span>
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                    {isCurrentAgentExpanded && (
                                        <>
                                            <span
                                                role="button"
                                                onClick={(e) => { e.stopPropagation(); handleCreateAgent() }}
                                                className={railIconButtonClassName}
                                                aria-label="新增 agent"
                                                title="新增 agent"
                                            >
                                                <Plus className="size-4"/>
                                            </span>
                                            <span
                                                role="button"
                                                onClick={(e) => { e.stopPropagation(); handleEditAgent() }}
                                                className={railIconButtonClassName}
                                                aria-label="编辑 agent"
                                                title="编辑 agent"
                                            >
                                                <Pencil className="size-4"/>
                                            </span>
                                            <span
                                                role="button"
                                                onClick={(e) => { e.stopPropagation(); handleDeleteModelPreset() }}
                                                className={railIconButtonClassName}
                                                aria-label="删除 agent"
                                                title="删除 agent"
                                            >
                                                <Trash2 className="size-4"/>
                                            </span>
                                        </>
                                    )}
                                    {isCurrentAgentExpanded ? (
                                        <ChevronUp className="size-5 shrink-0 text-text-secondary"/>
                                    ) : (
                                        <ChevronDown className="size-5 shrink-0 text-text-secondary"/>
                                    )}
                                </div>
                            </button>

                            {isCurrentAgentExpanded && (
                                <div className="mt-3 space-y-4 border-t border-border pt-3">
                                <div>
                                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
                                        <FileText className="size-4 text-text-secondary"/>
                                        Role context
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {activeAgentRoleFiles.map((file) => (
                                            <span
                                                key={file}
                                                className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-alt px-2.5 py-2 text-xs text-text-secondary"
                                            >
                                                <FileText className="size-3.5 shrink-0"/>
                                                <span className="truncate">{file}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleEditAgent}
                                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface-alt px-3 py-3 text-left transition-colors hover:bg-hover"
                                >
                                    <span className="flex min-w-0 items-center gap-3">
                                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-hover text-text-secondary">
                                            <Cpu className="size-4"/>
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold text-text-primary">{activeAgentModel}</span>
                                            <span className="mt-0.5 block truncate text-xs text-text-secondary">{modelConfig.baseUrl || 'No base URL'}</span>
                                        </span>
                                    </span>
                                    <ChevronRight className="size-4 shrink-0 text-text-muted"/>
                                </button>

                                <div className="space-y-3 pt-1">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                                <Wrench className="size-4 text-text-secondary"/>
                                                Function Calling
                                            </div>
                                            <div className="mt-0.5 text-xs text-text-secondary">启用后 agent 可调用工具</div>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={modelConfig.enableTools}
                                            onClick={() => updateModelConfig({enableTools: !modelConfig.enableTools})}
                                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                                                modelConfig.enableTools
                                                    ? 'border-[color:var(--color-toggle-on)] bg-[color:var(--color-toggle-on)]'
                                                    : 'border-[color:var(--color-toggle-off)] bg-[color:var(--color-toggle-off)]'
                                            }`}
                                        >
                                            <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                                                modelConfig.enableTools ? 'translate-x-6 bg-[color:var(--color-toggle-thumb-active)]' : 'translate-x-1 bg-[color:var(--color-toggle-thumb)]'
                                            }`}/>
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                                                <Brain className="size-4 text-text-secondary"/>
                                                Thinking enabled
                                            </div>
                                            <div className="mt-0.5 text-xs text-text-secondary">显示折叠思考</div>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={thinkingEnabled}
                                            disabled={!thinkingProtocolSelected}
                                            onClick={() => updateThinkingConfig({enabled: !thinkingConfig.enabled})}
                                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                                                thinkingEnabled
                                                    ? 'border-[color:var(--color-toggle-on)] bg-[color:var(--color-toggle-on)]'
                                                    : 'border-[color:var(--color-toggle-off)] bg-[color:var(--color-toggle-off)]'
                                            } ${!thinkingProtocolSelected ? 'cursor-not-allowed opacity-50' : ''}`}
                                        >
                                            <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                                                thinkingEnabled ? 'translate-x-6 bg-[color:var(--color-toggle-thumb-active)]' : 'translate-x-1 bg-[color:var(--color-toggle-thumb)]'
                                            }`}/>
                                        </button>
                                    </div>

                                    <div>
                                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
                                            <SlidersHorizontal className="size-4 text-text-secondary"/>
                                            Temperature
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="range"
                                                min={0}
                                                max={2}
                                                step={0.05}
                                                value={modelConfig.temperature}
                                                onChange={(e) => updateModelConfig({temperature: Number(e.target.value)})}
                                                className="min-w-0 flex-1 accent-text-primary"
                                            />
                                            <input
                                                type="number"
                                                min={0}
                                                max={2}
                                                step={0.05}
                                                value={modelConfig.temperature}
                                                onChange={(e) => updateModelConfig({temperature: Number(e.target.value)})}
                                                className="w-16 rounded-xl border border-border bg-surface-alt py-1.5 text-center text-sm text-text-primary shadow-[0_1px_2px_rgba(15,23,42,0.06)] outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-text-primary">Max tokens</div>
                                            <div className="mt-0.5 text-xs text-text-secondary">回复上限</div>
                                        </div>
                                        <div ref={maxTokensDropdownRef} className="relative w-[132px] shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => toggleInlineDropdown('maxTokens')}
                                                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                                                aria-haspopup="listbox"
                                                aria-expanded={isMaxTokensOpen}
                                                aria-label="Max tokens"
                                            >
                                                <span className="truncate text-text-primary">{selectedTokenOption.label}</span>
                                                <span className="text-xs text-text-muted">{selectedTokenOption.hint}</span>
                                                <ChevronDown className="size-4 text-text-muted"/>
                                            </button>

                                            {isMaxTokensOpen && (
                                                <div
                                                    className="absolute right-0 z-20 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface-alt shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                                                    role="listbox"
                                                    aria-label="Max tokens options"
                                                >
                                                    {tokenOptions.map((item) => {
                                                        const active = item.key === maxTokenPreset
                                                        return (
                                                            <button
                                                                key={item.key}
                                                                type="button"
                                                                onClick={() => {
                                                                    updateModelConfig({maxTokens: item.value})
                                                                    setActiveInlineDropdown(null)
                                                                }}
                                                                className={clsx(
                                                                    'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                                    active ? 'bg-settings-card-active text-text-primary' : 'bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                                                )}
                                                                role="option"
                                                                aria-selected={active}
                                                            >
                                                                <span>{item.label}</span>
                                                                <span className="text-xs text-text-muted">{item.hint}</span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-text-primary">Thinking protocol</div>
                                            <div className="mt-0.5 text-xs text-text-secondary">思考协议</div>
                                        </div>
                                        <div ref={thinkingProtocolDropdownRef} className="relative w-[132px] shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => toggleInlineDropdown('thinkingProtocol')}
                                                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                                                aria-haspopup="listbox"
                                                aria-expanded={isThinkingProtocolOpen}
                                                aria-label="Thinking protocol"
                                            >
                                                <span className="truncate text-text-primary">{selectedThinkingProtocol.label}</span>
                                                <span className="text-xs text-text-muted">{thinkingProtocolSelected ? 'set' : 'off'}</span>
                                                <ChevronDown className="size-4 text-text-muted"/>
                                            </button>

                                            {isThinkingProtocolOpen && (
                                                <div
                                                    className="absolute bottom-full right-0 z-20 mb-2 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface-alt shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                                                    role="listbox"
                                                    aria-label="Thinking protocol options"
                                                >
                                                    {thinkingProtocolOptions.map((item) => {
                                                        const active = item.value === thinkingConfig.protocol
                                                        return (
                                                            <button
                                                                key={item.value}
                                                                type="button"
                                                                onClick={() => {
                                                                    updateThinkingConfig({
                                                                        protocol: item.value,
                                                                        enabled: item.value === 'off' ? false : thinkingConfig.enabled,
                                                                    })
                                                                    setActiveInlineDropdown(null)
                                                                }}
                                                                className={clsx(
                                                                    'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                                    active ? 'bg-settings-card-active text-text-primary' : 'bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                                                )}
                                                                role="option"
                                                                aria-selected={active}
                                                            >
                                                                <span>{item.label}</span>
                                                                <span className="text-xs text-text-muted">{item.value === 'off' ? 'off' : 'on'}</span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-semibold text-text-primary">Thinking level</div>
                                            <div className="mt-0.5 text-xs text-text-secondary">思考强度</div>
                                        </div>
                                        <div ref={thinkingLevelDropdownRef} className="relative w-[132px] shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!thinkingProtocolSelected) return
                                                    toggleInlineDropdown('thinkingLevel')
                                                }}
                                                className={`flex w-full items-center justify-between rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${
                                                    !thinkingProtocolSelected ? 'cursor-not-allowed opacity-50' : ''
                                                }`}
                                                aria-haspopup="listbox"
                                                aria-expanded={isThinkingLevelOpen}
                                                aria-label="Thinking level"
                                                disabled={!thinkingProtocolSelected}
                                            >
                                                <span className="truncate text-text-primary">{selectedThinkingLevel.label}</span>
                                                <span className="text-xs text-text-muted">{thinkingProtocolSelected ? 'on' : 'off'}</span>
                                                <ChevronDown className="size-4 text-text-muted"/>
                                            </button>

                                            {isThinkingLevelOpen && thinkingProtocolSelected && (
                                                <div
                                                    className="absolute bottom-full right-0 z-20 mb-2 max-h-56 w-full overflow-auto rounded-xl border border-border bg-surface-alt shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                                                    role="listbox"
                                                    aria-label="Thinking level options"
                                                >
                                                    {thinkingLevelOptions.map((item) => {
                                                        const active = item.value === thinkingConfig.level
                                                        return (
                                                            <button
                                                                key={item.value}
                                                                type="button"
                                                                onClick={() => {
                                                                    updateThinkingConfig({level: item.value})
                                                                    setActiveInlineDropdown(null)
                                                                }}
                                                                className={clsx(
                                                                    'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                                    active ? 'bg-settings-card-active text-text-primary' : 'bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                                                )}
                                                                role="option"
                                                                aria-selected={active}
                                                            >
                                                                <span>{item.label}</span>
                                                                <span className="text-xs text-text-muted">{item.value}</span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                </div>
                            )}
                        </section>

                        <section className={railCardClassName} aria-label="Lecquy kernel">
                            <button
                                type="button"
                                onClick={() => setIsLecquyKernelExpanded(!isLecquyKernelExpanded)}
                                className="flex w-full items-center justify-between gap-3 text-left"
                            >
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <Database className="size-5 shrink-0 text-text-secondary"/>
                                    <h3 className="text-[18px] font-semibold leading-6 text-text-primary">Lecquy kernel</h3>
                                </div>
                                {isLecquyKernelExpanded ? (
                                    <ChevronUp className="size-5 shrink-0 text-text-secondary"/>
                                ) : (
                                    <ChevronDown className="size-5 shrink-0 text-text-secondary"/>
                                )}
                            </button>
                            {isLecquyKernelExpanded && (
                                <>
                                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                                        {kernelFiles.map((file) => (
                                            <button
                                                key={file.name}
                                                type="button"
                                                onClick={() => handleOpenContextPanel(file.name)}
                                                className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-alt px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                            >
                                                <FileText className="size-3.5 shrink-0"/>
                                                <span className="truncate">{file.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-3 rounded-2xl border border-border bg-surface-alt px-3 py-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold text-text-primary">memory.db</div>
                                                <div className="mt-0.5 text-xs text-text-secondary">SQLite · local memory</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleOpenContextPanel('MEMORY.md')}
                                                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                            >
                                                查看 / 编辑
                                            </button>
                                        </div>
                                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                                            衰减机制待实现，详见 CLAUDE.md §8.1
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>


                    </div>
                </div>

                {isContextPanelOpen && (
                    <div className="settings-scrollbar-hidden absolute inset-0 z-20 flex flex-col overflow-y-auto bg-surface-alt px-4 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <div>
                                <span className="text-base font-semibold text-text-primary">Lecquy kernel</span>
                                <p className="mt-1 text-xs text-text-secondary">Soul · Identity · User · Memory</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleCloseContextPanel}
                                aria-label="关闭上下文面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4"/>
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
                            <div className="grid grid-cols-2 gap-2">
                                {EDITABLE_CONTEXT_FILES.map((file) => {
                                    const active = selectedContextFile === file.name && !selectedManagedFile
                                    return (
                                        <button
                                            key={file.name}
                                            type="button"
                                            onClick={() => handleSelectContextFile(file.name)}
                                            className={clsx(
                                                'rounded-xl border px-3 py-3 text-left transition-colors',
                                                active
                                                    ? 'border-text-primary bg-settings-card-active text-text-primary'
                                                    : 'border-border bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                            )}
                                        >
                                            <div className="text-sm font-semibold">{file.title}</div>
                                            <div className="mt-1 text-xs">{file.summary}</div>
                                        </button>
                                    )
                                })}
                            </div>

                            <div className="rounded-xl border border-border bg-surface-alt p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 text-sm font-semibold text-text-primary">
                                        {selectedManagedFile ? selectedManagedFile : EDITABLE_CONTEXT_FILES.find((file) => file.name === selectedContextFile)?.title}
                                    </div>
                                    <span className="shrink-0 rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[11px] text-text-muted">
                                        {selectedManagedFile
                                            ? contextFiles[selectedManagedFile]?.path ?? `.lecquy/${selectedManagedFile}`
                                            : contextFiles[selectedContextFile]?.path ?? `.lecquy/${selectedContextFile}`}
                                    </span>
                                </div>
                                <div className="mt-2 truncate text-xs text-text-secondary">
                                    {selectedManagedFile
                                        ? contextFiles[selectedManagedFile]?.description ?? '系统托管文件，仅供查看。'
                                        : contextFiles[selectedContextFile]?.description ?? ''}
                                </div>

                                {contextError && (
                                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                                        {contextError}
                                    </div>
                                )}

                                {contextLoading ? (
                                    <div className="mt-4 rounded-xl border border-border bg-surface-alt px-3 py-8 text-sm text-text-secondary">
                                        正在加载上下文文件...
                                    </div>
                                ) : selectedManagedFile ? (
                                    <pre className="mt-4 min-h-[16rem] overflow-auto rounded-xl border border-border bg-surface-alt px-3 py-3 text-xs leading-6 text-text-primary">
                                        {contextFiles[selectedManagedFile]?.content || '(empty)'}
                                    </pre>
                                ) : (
                                    <textarea
                                        value={contextDrafts[selectedContextFile]}
                                        onChange={(event) => {
                                            setContextDrafts((prev) => ({
                                                ...prev,
                                                [selectedContextFile]: event.target.value,
                                            }))
                                            setContextSaveStatus('Editing')
                                            setContextError(null)
                                        }}
                                        placeholder="在这里编辑上下文内容..."
                                        className="mt-4 min-h-[16rem] w-full resize-none rounded-xl border border-border bg-surface-alt px-3 py-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                        spellCheck
                                    />
                                )}

                                {!selectedManagedFile && selectedContextFile === 'MEMORY.md' && (
                                    <div className="mt-4 space-y-4 border-t border-border pt-4">
                                        <div>
                                            <div className="text-sm font-semibold text-text-primary">Memory runtime</div>
                                            <div className="mt-1 text-xs text-text-secondary">记忆引擎配置与只读日志入口</div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-secondary">Embedding base URL</label>
                                            <input
                                                value={memoryDraftConfig.embeddingBaseUrl}
                                                onChange={(e) => {
                                                    setMemoryDraftConfig((prev) => ({
                                                        ...prev,
                                                        embeddingBaseUrl: e.target.value,
                                                    }))
                                                    setMemorySaveStatus('Editing')
                                                }}
                                                placeholder="http://127.0.0.1:8000/v1"
                                                className="w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-secondary">Flush turns</label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={memoryDraftConfig.flushTurns}
                                                onChange={(e) => {
                                                    setMemoryDraftConfig((prev) => ({
                                                        ...prev,
                                                        flushTurns: Number(e.target.value || memoryConfig.flushTurns || 20),
                                                    }))
                                                    setMemorySaveStatus('Editing')
                                                }}
                                                className="w-28 rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                            />
                                        </div>

                                        {selectedMemoryFile ? (
                                            <div className="rounded-xl border border-border bg-surface-alt p-3">
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedMemoryFile(null)
                                                            setSelectedMemoryContent('')
                                                        }}
                                                        className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                                    >
                                                        返回日志列表
                                                    </button>
                                                    <span className="truncate text-xs text-text-muted">{selectedMemoryFile}</span>
                                                </div>
                                                <pre className="max-h-56 overflow-auto text-xs leading-6 text-text-primary">
                                                    {selectedMemoryContent || '(empty)'}
                                                </pre>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-border bg-surface-alt p-3">
                                                <div className="mb-2 text-xs text-text-secondary">Memory logs (read-only) · {memoryFiles.length}</div>
                                                <div className="max-h-52 space-y-2 overflow-auto">
                                                    {memoryFiles.map((file) => (
                                                        <button
                                                            key={file.name}
                                                            type="button"
                                                            onClick={() => void handleOpenMemoryFile(file.name)}
                                                            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                                        >
                                                            <span className="truncate">{file.name}</span>
                                                            <span className="ml-2 shrink-0 text-[11px] text-text-muted">
                                                                {new Date(file.updatedAt).toLocaleDateString()}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 border-t border-border pt-4">
                                    <div className="mb-2 text-sm font-semibold text-text-primary">Managed by system</div>
                                    <div className="flex gap-2">
                                        {MANAGED_CONTEXT_FILES.map((file) => {
                                            const active = selectedManagedFile === file.name
                                            return (
                                                <button
                                                    key={file.name}
                                                    type="button"
                                                    onClick={() => handleSelectManagedFile(file.name)}
                                                    className={clsx(
                                                        'rounded-full border px-3 py-1.5 text-xs transition-colors',
                                                        active
                                                            ? 'border-text-primary bg-settings-card-active text-text-primary'
                                                            : 'border-border bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                >
                                                    {file.title}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4 text-xs text-text-muted">
                                    {selectedManagedFile
                                        ? 'Managed files are read-only.'
                                        : `${contextSaveStatus === 'Editing' ? 'Saving...' : 'Saved'} · ${selectedContextFile === 'MEMORY.md' ? (memorySaveStatus === 'Editing' ? '同步保存 Memory runtime...' : 'Memory runtime 已同步') : 'Context files are saved to .lecquy'}`}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {isModelPanelOpen && (
                    <div className="settings-scrollbar-hidden absolute inset-0 z-20 flex flex-col overflow-y-auto bg-surface-alt px-4 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <span className="text-base font-semibold text-text-primary">Agent profile</span>
                            <button
                                type="button"
                                onClick={() => setIsModelPanelOpen(false)}
                                aria-label="关闭 agent 面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4"/>
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                            <div className="relative w-full">
                                <button
                                    type="button"
                                    onClick={() => setIsModelOptionsOpen((prev) => !prev)}
                                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none"
                                    aria-haspopup="listbox"
                                    aria-expanded={isModelOptionsOpen}
                                    aria-label="Agent preset"
                                >
                                    <span className="truncate">
                                        {selectedModelPresetId === NEW_MODEL_PRESET_VALUE
                                            ? '+ Create new agent'
                                            : getModelPresetLabel(modelPresets.find((item) => item.id === selectedModelPresetId) ?? null)}
                                    </span>
                                    <ChevronDown className="size-4 text-text-muted"/>
                                </button>

                                {isModelOptionsOpen && (
                                    <div
                                        className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface-alt shadow-sm"
                                        role="listbox"
                                        aria-label="Agent preset options"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleModelPresetSelection(NEW_MODEL_PRESET_VALUE)
                                                setIsModelOptionsOpen(false)
                                            }}
                                            className={clsx(
                                                'flex w-full items-center px-3 py-2 text-left text-sm',
                                                selectedModelPresetId === NEW_MODEL_PRESET_VALUE
                                                    ? 'bg-settings-card-active text-text-primary'
                                                    : 'bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                            )}
                                            role="option"
                                            aria-selected={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                        >
                                            + Create new agent
                                        </button>
                                        {modelPresets.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    handleModelPresetSelection(item.id)
                                                    setIsModelOptionsOpen(false)
                                                }}
                                                className={clsx(
                                                    'flex w-full items-center px-3 py-2 text-left text-sm',
                                                    selectedModelPresetId === item.id
                                                        ? 'bg-settings-card-active text-text-primary'
                                                        : 'bg-surface-alt text-text-secondary hover:bg-hover hover:text-text-primary',
                                                )}
                                                role="option"
                                                aria-selected={selectedModelPresetId === item.id}
                                            >
                                                <span className="flex min-w-0 flex-col">
                                                    <span className="truncate">{getModelPresetLabel(item)}</span>
                                                    <span className="truncate text-xs text-text-muted">{getModelPresetModelLabel(item)}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <input
                                value={draftAgentName}
                                onChange={(e) => {
                                    setDraftAgentName(e.target.value)
                                    setModelSaveStatus('Editing')
                                }}
                                placeholder="agent name"
                                className="w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />

                            <div className="flex items-center gap-2">
                                <input
                                    value={draftModel}
                                    onChange={(e) => {
                                        setDraftModel(e.target.value)
                                        setModelSaveStatus('Editing')
                                    }}
                                    placeholder="model name"
                                    className="flex-1 rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleConnectModel()}
                                    disabled={modelsLoading || !draftBaseUrl.trim()}
                                    className="shrink-0 rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {modelsLoading ? '连接中...' : '连接'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteModelPreset}
                                    disabled={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="Delete agent"
                                >
                                    <Trash2 className="size-4"/>
                                </button>
                            </div>

                            {modelsError && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                                    {modelsError}
                                </div>
                            )}
                            <input
                                value={draftBaseUrl}
                                onChange={(e) => {
                                    setDraftBaseUrl(e.target.value)
                                    setModelSaveStatus('Editing')
                                    setModelsError(null)
                                }}
                                placeholder="baseUrl"
                                className="w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />
                            <input
                                value={draftApiKey}
                                onChange={(e) => {
                                    setDraftApiKey(e.target.value)
                                    setModelSaveStatus('Editing')
                                    setModelsError(null)
                                }}
                                placeholder="apiKey"
                                className="w-full rounded-xl border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />

                            <div className="mt-auto text-xs text-text-muted">
                                Agent profiles are saved in local storage. Model is only the selected agent runtime.
                            </div>
                        </div>
                    </div>
                )}

                </div>
            </div>
        </div>
    )
}
