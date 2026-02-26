import { ChevronDown, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import type { ModelConfig } from '../../../hooks/useChat'

interface SystemPromptItem {
    id: string
    title: string
    prompt: string
}

interface ModelPresetItem {
    id: string
    title: string
    model: string
    baseUrl: string
    apiKey: string
}

/**
 * SettingsDrawer 的 Props
 *
 */
interface SettingsDrawerProps {
    isOpen: boolean
    onClose: () => void
    systemPrompts: SystemPromptItem[]
    activePromptId: string | null
    onSystemPromptsChange: (items: SystemPromptItem[]) => void
    onActivePromptChange: (id: string | null) => void
    modelConfig: ModelConfig
    onModelConfigChange: (config: ModelConfig) => void
}

const MODEL_PRESET_STORAGE_KEY = 'webclaw.modelPresets'
const ACTIVE_MODEL_PRESET_STORAGE_KEY = 'webclaw.activeModelPresetId'

function loadModelPresetsFromStorage(): ModelPresetItem[] {
    try {
        const raw = localStorage.getItem(MODEL_PRESET_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function loadActiveModelPresetIdFromStorage(): string | null {
    try {
        return localStorage.getItem(ACTIVE_MODEL_PRESET_STORAGE_KEY)
    } catch {
        return null
    }
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
                                   systemPrompts,
                                   activePromptId,
                                   onSystemPromptsChange,
                                   onActivePromptChange,
                                   modelConfig,
                                   onModelConfigChange,
                               }: SettingsDrawerProps) {
    const NEW_PROMPT_VALUE = '__new__'
    const NEW_MODEL_PRESET_VALUE = '__new_model__'

    const [isSystemPanelOpen, setIsSystemPanelOpen] = useState(false)
    const [isPromptOptionsOpen, setIsPromptOptionsOpen] = useState(false)
    const [isModelOptionsOpen, setIsModelOptionsOpen] = useState(false)
    const [isMaxTokensOpen, setIsMaxTokensOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [isModelPanelOpen, setIsModelPanelOpen] = useState(false)
    const [selectedPromptId, setSelectedPromptId] = useState<string>(activePromptId ?? NEW_PROMPT_VALUE)
    const [draftTitle, setDraftTitle] = useState('')
    const [draftPrompt, setDraftPrompt] = useState('')
    const [saveStatus, setSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const [modelPresets, setModelPresets] = useState<ModelPresetItem[]>(() => loadModelPresetsFromStorage())
    const [selectedModelPresetId, setSelectedModelPresetId] = useState<string>(() => {
        return loadActiveModelPresetIdFromStorage() ?? NEW_MODEL_PRESET_VALUE
    })
    const [draftModelTitle, setDraftModelTitle] = useState('')
    const [draftModel, setDraftModel] = useState('')
    const [draftBaseUrl, setDraftBaseUrl] = useState('')
    const [draftApiKey, setDraftApiKey] = useState('')
    const [modelSaveStatus, setModelSaveStatus] = useState<'Saved' | 'Editing'>('Saved')

    const updateModelConfig = (partial: Partial<ModelConfig>) => {
        onModelConfigChange({ ...modelConfig, ...partial })
    }

    const maxTokenPreset = (() => {
        if (modelConfig.maxTokens <= 8192) return 'low'
        if (modelConfig.maxTokens <= 16384) return 'medium'
        return 'high'
    })()

    const activePrompt = systemPrompts.find((p) => p.id === activePromptId) ?? null
    const activeModelPreset = modelPresets.find((p) => p.id === selectedModelPresetId) ?? null
    const tokenOptions = [
        { key: 'low', label: 'Low', hint: '8k', value: 8192 },
        { key: 'medium', label: 'Middle', hint: '16k', value: 16384 },
        { key: 'high', label: 'High', hint: '32k', value: 32768 },
    ] as const
    const selectedTokenOption =
        tokenOptions.find((item) => item.key === maxTokenPreset) ?? tokenOptions[0]

    useEffect(() => {
        // 首次没有模型预设时，按当前模型配置创建一个默认预设，便于后续编辑/切换。
        if (modelPresets.length > 0) return
        const id = `model_${Date.now()}`
        const initial: ModelPresetItem = {
            id,
            title: 'Default model',
            model: modelConfig.model || '',
            baseUrl: modelConfig.baseUrl || '',
            apiKey: modelConfig.apiKey || '',
        }
        setModelPresets([initial])
        setSelectedModelPresetId(id)
    }, [modelConfig.apiKey, modelConfig.baseUrl, modelConfig.model, modelPresets.length])

    useEffect(() => {
        localStorage.setItem(MODEL_PRESET_STORAGE_KEY, JSON.stringify(modelPresets))
    }, [modelPresets])

    useEffect(() => {
        if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
            localStorage.removeItem(ACTIVE_MODEL_PRESET_STORAGE_KEY)
            return
        }
        localStorage.setItem(ACTIVE_MODEL_PRESET_STORAGE_KEY, selectedModelPresetId)
    }, [selectedModelPresetId])

    useEffect(() => {
        if (!isSystemPanelOpen) return
        const initialId = activePromptId ?? NEW_PROMPT_VALUE
        setSelectedPromptId(initialId)
        if (initialId === NEW_PROMPT_VALUE) {
            setDraftTitle('')
            setDraftPrompt('')
        } else {
            const selected = systemPrompts.find((p) => p.id === initialId)
            setDraftTitle(selected?.title ?? '')
            setDraftPrompt(selected?.prompt ?? '')
        }
        setSaveStatus('Saved')
    }, [isSystemPanelOpen, activePromptId, systemPrompts])

    useEffect(() => {
        if (!isModelPanelOpen) return
        const initialId = selectedModelPresetId ?? NEW_MODEL_PRESET_VALUE
        setSelectedModelPresetId(initialId)
        if (initialId === NEW_MODEL_PRESET_VALUE) {
            setDraftModelTitle('')
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
        } else {
            const selected = modelPresets.find((p) => p.id === initialId)
            setDraftModelTitle(selected?.title ?? '')
            setDraftModel(selected?.model ?? '')
            setDraftBaseUrl(selected?.baseUrl ?? '')
            setDraftApiKey(selected?.apiKey ?? '')
        }
        setModelSaveStatus('Saved')
    }, [isModelPanelOpen, modelPresets, selectedModelPresetId])

    useEffect(() => {
        if (!isSystemPanelOpen || saveStatus !== 'Editing') return

        const timer = window.setTimeout(() => {
            if (selectedPromptId === NEW_PROMPT_VALUE) {
                if (!draftTitle.trim() && !draftPrompt.trim()) {
                    setSaveStatus('Saved')
                    return
                }
                const nextId = `prompt_${Date.now()}`
                const nextItems = [
                    ...systemPrompts,
                    { id: nextId, title: draftTitle, prompt: draftPrompt },
                ]
                onSystemPromptsChange(nextItems)
                onActivePromptChange(nextId)
                setSelectedPromptId(nextId)
                setSaveStatus('Saved')
                return
            }

            const nextItems = systemPrompts.map((item) =>
                item.id === selectedPromptId
                    ? { ...item, title: draftTitle, prompt: draftPrompt }
                    : item,
            )
            onSystemPromptsChange(nextItems)
            onActivePromptChange(selectedPromptId)
            setSaveStatus('Saved')
        }, 250)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        draftPrompt,
        draftTitle,
        isSystemPanelOpen,
        onActivePromptChange,
        onSystemPromptsChange,
        saveStatus,
        selectedPromptId,
        systemPrompts,
    ])

    useEffect(() => {
        if (!isModelPanelOpen || modelSaveStatus !== 'Editing') return

        const timer = window.setTimeout(() => {
            if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
                if (!draftModelTitle.trim() && !draftModel.trim() && !draftBaseUrl.trim() && !draftApiKey.trim()) {
                    setModelSaveStatus('Saved')
                    return
                }
                const nextId = `model_${Date.now()}`
                const newItem: ModelPresetItem = {
                    id: nextId,
                    title: draftModelTitle.trim() || 'Untitled model',
                    model: draftModel,
                    baseUrl: draftBaseUrl,
                    apiKey: draftApiKey,
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
                        title: draftModelTitle.trim() || 'Untitled model',
                        model: draftModel,
                        baseUrl: draftBaseUrl,
                        apiKey: draftApiKey,
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
        draftApiKey,
        draftBaseUrl,
        draftModel,
        draftModelTitle,
        isModelPanelOpen,
        modelConfig,
        modelPresets,
        modelSaveStatus,
        onModelConfigChange,
        selectedModelPresetId,
    ])

    const handlePromptSelection = (value: string) => {
        setSelectedPromptId(value)
        if (value === NEW_PROMPT_VALUE) {
            setDraftTitle('Untitled instruction')
            setDraftPrompt('')
            onActivePromptChange(null)
            setSaveStatus('Saved')
            setIsPromptOptionsOpen(false)
            return
        }
        const selected = systemPrompts.find((p) => p.id === value)
        setDraftTitle(selected?.title ?? '')
        setDraftPrompt(selected?.prompt ?? '')
        onActivePromptChange(value)
        setSaveStatus('Saved')
        setIsPromptOptionsOpen(false)
    }

    const handleDeletePrompt = () => {
        if (selectedPromptId === NEW_PROMPT_VALUE) return
        setIsDeleteDialogOpen(true)
    }

    const confirmDeletePrompt = () => {
        if (selectedPromptId === NEW_PROMPT_VALUE) return
        const nextItems = systemPrompts.filter((item) => item.id !== selectedPromptId)
        onSystemPromptsChange(nextItems)
        onActivePromptChange(null)
        setSelectedPromptId(NEW_PROMPT_VALUE)
        setDraftTitle('')
        setDraftPrompt('')
        setSaveStatus('Saved')
        setIsPromptOptionsOpen(false)
        setIsDeleteDialogOpen(false)
    }

    const handleModelPresetSelection = (value: string) => {
        setSelectedModelPresetId(value)
        if (value === NEW_MODEL_PRESET_VALUE) {
            setDraftModelTitle('')
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
            setModelSaveStatus('Saved')
            return
        }
        const selected = modelPresets.find((item) => item.id === value)
        setDraftModelTitle(selected?.title ?? '')
        setDraftModel(selected?.model ?? '')
        setDraftBaseUrl(selected?.baseUrl ?? '')
        setDraftApiKey(selected?.apiKey ?? '')
        if (selected) {
            onModelConfigChange({
                ...modelConfig,
                model: selected.model,
                baseUrl: selected.baseUrl,
                apiKey: selected.apiKey,
            })
        }
        setModelSaveStatus('Saved')
    }

    const handleDeleteModelPreset = () => {
        if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) return
        const nextItems = modelPresets.filter((item) => item.id !== selectedModelPresetId)
        setModelPresets(nextItems)
        setSelectedModelPresetId(NEW_MODEL_PRESET_VALUE)
        setDraftModelTitle('')
        setDraftModel('')
        setDraftBaseUrl('')
        setDraftApiKey('')
        setModelSaveStatus('Saved')
    }

    return (
        <div
            className={clsx(
                // 定位：固定在视口右侧
                // 尺寸：占满高度，宽 320px
                "h-screen w-80 shrink-0",
                // 外观：背景与主页面统一，降低分栏割裂感
                "bg-surface-alt",
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
                    "h-12 px-6",
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
            <div className="relative h-[calc(100vh-48px)] overflow-y-auto px-6 py-5">
                <div className="selector-container space-y-3">
                    <div className="settings-item settings-model-selector">
                        <div className="item-input-form-field">
                            {/* 背景色修改：卡片改为白底 + 浅边框 + 微阴影 */}
                            <button
                                type="button"
                                onClick={() => setIsModelPanelOpen(true)}
                                className="model-selector-card w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-[var(--shadow-input)]"
                            >
                                <span className="block text-sm font-semibold text-gray-900">Model selection</span>
                                <span className="mt-1 block text-xs text-gray-500">
                                    {activeModelPreset?.title || modelConfig.model || '未设置模型'}
                                </span>
                                <span className="mt-1 block text-xs text-gray-500">
                                    {modelConfig.model || 'Select a model and adjust runtime parameters'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* 背景色修改：卡片改为白底 + 浅边框 + 微阴影 */}
                    <button
                        type="button"
                        onClick={() => setIsSystemPanelOpen(true)}
                        className="system-instructions-card w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-[var(--shadow-input)]"
                    >
                        <span className="block text-sm font-semibold text-gray-900">System instructions</span>
                        <span className="mt-1 block text-xs text-gray-500">
                            {activePrompt?.title || 'Optional tone and style instructions for the model'}
                        </span>
                    </button>
                </div>

                <div className="my-6 h-px w-full bg-border" role="separator" aria-orientation="horizontal" />

                <div className="settings-item-column settings-item-spacer">
                    <div className="item-about item-about-slider">
                        <div className="item-description">
                            <h3 className="item-description-title text-sm font-semibold text-text-primary">Temperature</h3>
                        </div>
                    </div>
                    <div className="item-input mt-3 flex items-center gap-3">
                        <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.05}
                            value={modelConfig.temperature}
                            onChange={(e) => updateModelConfig({ temperature: Number(e.target.value) })}
                            className="flex-1 accent-text-primary"
                        />
                        {/* 背景色修改：数字输入框改为白底 + 浅边框 + 微阴影 */}
                        <input
                            type="number"
                            min={0}
                            max={2}
                            step={0.05}
                            value={modelConfig.temperature}
                            onChange={(e) => updateModelConfig({ temperature: Number(e.target.value) })}
                            className="w-14 rounded-lg border border-gray-200 bg-white py-1 text-center text-sm text-gray-900 shadow-sm outline-none"
                        />
                    </div>
                </div>

                <div className="my-6 h-px w-full bg-border" role="separator" aria-orientation="horizontal" />

                <div className="settings-item settings-item-column">
                    <div className="item-about">
                        <div className="item-description">
                            <h3 className="item-description-title text-sm font-semibold text-text-primary">Max tokens</h3>
                        </div>
                    </div>
                    <div className="item-input-form-field mt-3">
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsMaxTokensOpen((prev) => !prev)}
                                className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
                                aria-haspopup="listbox"
                                aria-expanded={isMaxTokensOpen}
                                aria-label="Max tokens"
                            >
                                <div className="flex w-full items-center justify-between pr-2">
                                    <span className="text-gray-900">{selectedTokenOption.label}</span>
                                    <span className="text-xs text-gray-300">{selectedTokenOption.hint}</span>
                                </div>
                                <ChevronDown className="size-4 text-gray-400" />
                            </button>

                            {isMaxTokensOpen && (
                                <div
                                    className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
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
                                                    updateModelConfig({ maxTokens: item.value })
                                                    setIsMaxTokensOpen(false)
                                                }}
                                                className={clsx(
                                                    'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                    active ? 'bg-gray-50 text-gray-900' : 'bg-white text-gray-800 hover:bg-gray-50',
                                                )}
                                                role="option"
                                                aria-selected={active}
                                            >
                                                <span>{item.label}</span>
                                                <span className="text-xs text-gray-300">{item.hint}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {isModelPanelOpen && (
                    <div className="absolute inset-0 z-20 flex flex-col bg-surface-alt px-6 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <span className="text-base font-semibold text-text-primary">Model selection</span>
                            <button
                                type="button"
                                onClick={() => setIsModelPanelOpen(false)}
                                aria-label="关闭模型面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                            <div className="relative w-full">
                                <button
                                    type="button"
                                    onClick={() => setIsModelOptionsOpen((prev) => !prev)}
                                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none"
                                    aria-haspopup="listbox"
                                    aria-expanded={isModelOptionsOpen}
                                    aria-label="Model preset"
                                >
                                    <span className="truncate">
                                        {selectedModelPresetId === NEW_MODEL_PRESET_VALUE
                                            ? '+ Create new model setting'
                                            : modelPresets.find((item) => item.id === selectedModelPresetId)?.title || 'Untitled model'}
                                    </span>
                                    <ChevronDown className="size-4 text-text-muted" />
                                </button>

                                {isModelOptionsOpen && (
                                    <div
                                        className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                                        role="listbox"
                                        aria-label="Model preset options"
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
                                                    ? 'bg-hover text-text-primary'
                                                    : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                            )}
                                            role="option"
                                            aria-selected={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                        >
                                            + Create new model setting
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
                                                        ? 'bg-hover text-text-primary'
                                                        : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                                )}
                                                role="option"
                                                aria-selected={selectedModelPresetId === item.id}
                                            >
                                                {item.title || 'Untitled model'}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    value={draftModelTitle}
                                    onChange={(e) => {
                                        setDraftModelTitle(e.target.value)
                                        setModelSaveStatus('Editing')
                                    }}
                                    placeholder="Title"
                                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                />
                                <button
                                    type="button"
                                    onClick={handleDeleteModelPreset}
                                    disabled={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="Delete model setting"
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </div>

                            <input
                                value={draftModel}
                                onChange={(e) => {
                                    setDraftModel(e.target.value)
                                    setModelSaveStatus('Editing')
                                }}
                                placeholder="model"
                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />
                            <input
                                value={draftBaseUrl}
                                onChange={(e) => {
                                    setDraftBaseUrl(e.target.value)
                                    setModelSaveStatus('Editing')
                                }}
                                placeholder="baseUrl"
                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />
                            <input
                                value={draftApiKey}
                                onChange={(e) => {
                                    setDraftApiKey(e.target.value)
                                    setModelSaveStatus('Editing')
                                }}
                                placeholder="apiKey"
                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />

                            <div className="mt-auto text-xs text-text-muted">
                                Model settings are saved in local storage.
                            </div>
                        </div>
                    </div>
                )}

                {isSystemPanelOpen && (
                    <div className="absolute inset-0 z-10 flex flex-col bg-surface-alt px-6 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <span className="text-base font-semibold text-text-primary">System instructions</span>
                            <button
                                type="button"
                                onClick={() => setIsSystemPanelOpen(false)}
                                aria-label="关闭面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                            <div className="flex items-center gap-2">
                                <div className="relative w-full">
                                    <button
                                        type="button"
                                        onClick={() => setIsPromptOptionsOpen((prev) => !prev)}
                                        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none"
                                        aria-haspopup="listbox"
                                        aria-expanded={isPromptOptionsOpen}
                                        aria-label="System instruction"
                                    >
                                        <span className="truncate">
                                            {selectedPromptId === NEW_PROMPT_VALUE
                                                ? '+ Create new instruction'
                                                : systemPrompts.find((item) => item.id === selectedPromptId)?.title || 'Untitled instruction'}
                                        </span>
                                        <ChevronDown className="size-4 text-text-muted" />
                                    </button>

                                    {isPromptOptionsOpen && (
                                        <div
                                            className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                                            role="listbox"
                                            aria-label="System instruction options"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => handlePromptSelection(NEW_PROMPT_VALUE)}
                                                className={clsx(
                                                    'flex w-full items-center px-3 py-2 text-left text-sm',
                                                    selectedPromptId === NEW_PROMPT_VALUE
                                                        ? 'bg-hover text-text-primary'
                                                        : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                                )}
                                                role="option"
                                                aria-selected={selectedPromptId === NEW_PROMPT_VALUE}
                                            >
                                                + Create new instruction
                                            </button>
                                            {systemPrompts.map((item) => (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => handlePromptSelection(item.id)}
                                                    className={clsx(
                                                        'flex w-full items-center px-3 py-2 text-left text-sm',
                                                        selectedPromptId === item.id
                                                            ? 'bg-hover text-text-primary'
                                                            : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                    role="option"
                                                    aria-selected={selectedPromptId === item.id}
                                                >
                                                    {item.title || 'Untitled instruction'}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    value={draftTitle}
                                    onChange={(e) => {
                                        setDraftTitle(e.target.value)
                                        setSaveStatus('Editing')
                                    }}
                                    placeholder="Title"
                                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                />
                                <button
                                    type="button"
                                    onClick={handleDeletePrompt}
                                    disabled={selectedPromptId === NEW_PROMPT_VALUE || !selectedPromptId}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="Delete system instruction"
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </div>

                            <textarea
                                aria-label="System instructions"
                                value={draftPrompt}
                                onChange={(e) => {
                                    setDraftPrompt(e.target.value)
                                    setSaveStatus('Editing')
                                }}
                                placeholder="Optional tone and style instructions for the model"
                                className="min-h-0 flex-1 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                spellCheck
                            />

                            <div className="mt-auto text-xs text-text-muted">
                                Instructions are saved in local storage.
                            </div>
                        </div>

                        {isDeleteDialogOpen && (
                            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                                <div
                                    role="dialog"
                                    aria-modal="true"
                                    aria-label="确认删除提示词"
                                    className="mx-4 w-full max-w-xs rounded-xl border border-gray-200 bg-white p-4 shadow-lg"
                                >
                                    <div className="text-sm font-semibold text-gray-900">删除提示词？</div>
                                    <div className="mt-2 text-xs text-gray-500">
                                        删除后无法恢复，确认继续吗？
                                    </div>
                                    <div className="mt-4 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsDeleteDialogOpen(false)}
                                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
                                        >
                                            取消
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmDeletePrompt}
                                            className="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-600"
                                        >
                                            删除
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
