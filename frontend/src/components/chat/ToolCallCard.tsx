import clsx from 'clsx'
import { AlertCircle, ChevronDown, LoaderCircle, ShieldAlert, Wrench } from 'lucide-react'
import type { MessageToolCallBlock } from '../../lib/message-blocks'

interface ToolCallCardProps {
  block: MessageToolCallBlock
  onToggle: () => void
  compact?: boolean
}

/**
 * 只有失败且存在错误信息 / 详情的卡片才能展开；否则 tool 卡是纯展示单行，避免误导点击。
 */
export function getEffectiveToolCallExpanded(block: MessageToolCallBlock): boolean {
  if (block.status !== 'error') return false
  if (typeof block.manualExpanded === 'boolean') return block.manualExpanded
  return true
}

function hasExpandableDetail(block: MessageToolCallBlock): boolean {
  return block.status === 'error' && Boolean(block.errorMessage || block.errorDetail)
}

function formatErrorDetail(errorDetail: MessageToolCallBlock['errorDetail']): string | null {
  if (!errorDetail) return null
  if (typeof errorDetail === 'string') return errorDetail
  return errorDetail.message ?? errorDetail.ruleContent ?? JSON.stringify(errorDetail, null, 2)
}

function extractPermissionDeniedDetail(block: MessageToolCallBlock): { ruleContent?: string; message?: string } | null {
  if (!block.errorDetail || typeof block.errorDetail !== 'object') return null
  if (!('code' in block.errorDetail) || block.errorDetail.code !== 'permission_denied') return null

  return {
    ruleContent: 'ruleContent' in block.errorDetail && typeof block.errorDetail.ruleContent === 'string'
      ? block.errorDetail.ruleContent
      : undefined,
    message: 'message' in block.errorDetail && typeof block.errorDetail.message === 'string'
      ? block.errorDetail.message
      : undefined,
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function extractStringArg(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object' || !(key in args)) return null
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function basename(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  return segments.at(-1) || normalized
}

function summarizeCommand(command: string | null): string | null {
  if (!command) return null
  const compact = command.replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return compact.length > 36 ? `${compact.slice(0, 33)}...` : compact
}

interface ToolCardPresentation {
  title: string
  hidden: boolean
}

function resolveWriteAction(block: MessageToolCallBlock): 'created' | 'updated' | 'unknown' {
  if (!block.result || typeof block.result !== 'object' || !('details' in block.result)) return 'unknown'
  const details = (block.result as { details?: unknown }).details
  if (!details || typeof details !== 'object' || !('writeMode' in details)) return 'unknown'
  const writeMode = (details as { writeMode?: unknown }).writeMode
  return writeMode === 'created' || writeMode === 'updated' ? writeMode : 'unknown'
}

function resolveToolPresentation(block: MessageToolCallBlock): ToolCardPresentation {
  const fileName = basename(extractStringArg(block.args, 'file_path'))
  const skillName = extractStringArg(block.args, 'skill_name')
  const readPath = basename(extractStringArg(block.args, 'path'))
  const commandSummary = summarizeCommand(extractStringArg(block.args, 'command'))

  switch (block.name) {
    case 'write_file': {
      if (block.status !== 'error') {
        return { title: '', hidden: true }
      }
      const action = resolveWriteAction(block)
      if (action === 'updated') {
        return { title: fileName ? `Failed to update ${fileName}` : 'Failed to update a file', hidden: false }
      }
      return { title: fileName ? `Failed to create ${fileName}` : 'Failed to create a file', hidden: false }
    }
    case 'edit_file':
      if (block.status === 'running') return { title: fileName ? `Editing ${fileName}` : 'Editing a file', hidden: false }
      if (block.status === 'error') return { title: fileName ? `Failed to edit ${fileName}` : 'Failed to edit a file', hidden: false }
      return { title: fileName ? `Edited ${fileName}` : 'Edited a file', hidden: false }
    case 'read_file':
      if (block.status === 'running') return { title: readPath ? `Reading ${readPath}` : 'Reading a file', hidden: false }
      if (block.status === 'error') return { title: readPath ? `Failed to read ${readPath}` : 'Failed to read a file', hidden: false }
      return { title: readPath ? `Viewed ${readPath}` : 'Viewed a file', hidden: false }
    case 'skill':
      if (block.status === 'running') return { title: skillName ? `Loading ${skillName}` : 'Loading a skill', hidden: false }
      if (block.status === 'error') return { title: skillName ? `Failed to load ${skillName}` : 'Failed to load a skill', hidden: false }
      return { title: skillName ? `Loaded ${skillName}` : 'Loaded a skill', hidden: false }
    case 'bash':
      if (block.status === 'running') return { title: commandSummary ? `Running ${commandSummary}` : 'Running a command', hidden: false }
      if (block.status === 'error') return { title: commandSummary ? `Command failed: ${commandSummary}` : 'Command failed', hidden: false }
      return { title: commandSummary ? `Ran ${commandSummary}` : 'Ran a command', hidden: false }
    default:
      if (block.status === 'running') return { title: 'Using a tool', hidden: false }
      if (block.status === 'error') return { title: 'Tool execution failed', hidden: false }
      return { title: 'Used a tool', hidden: false }
  }
}

export function shouldRenderToolCallCard(block: MessageToolCallBlock): boolean {
  return !resolveToolPresentation(block).hidden
}

function ToolStatusIcon({ block }: { block: MessageToolCallBlock }) {
  if (extractPermissionDeniedDetail(block)) {
    return <ShieldAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
  }
  if (block.status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-text-muted" />
  }
  if (block.status === 'error') {
    return <AlertCircle className="size-3.5 shrink-0 text-[#b44a4a] dark:text-[#f2b8b8]" />
  }
  // success / unknown 使用同一中性图标（Wrench）
  return <Wrench className="size-3.5 shrink-0 text-text-muted" />
}

export function ToolCallCard({ block, onToggle, compact = false }: ToolCallCardProps) {
  const presentation = resolveToolPresentation(block)
  if (presentation.hidden) return null

  const permissionDenied = extractPermissionDeniedDetail(block)
  const errorDetailText = formatErrorDetail(block.errorDetail)
  const expanded = getEffectiveToolCallExpanded(block)
  const isError = block.status === 'error'
  const expandable = !permissionDenied && hasExpandableDetail(block)
  const durationLabel = block.status === 'success'
    && typeof block.startedAt === 'number'
    && typeof block.endedAt === 'number'
    ? formatDuration(Math.max(0, block.endedAt - block.startedAt))
    : null

  if (permissionDenied) {
    return (
      <div
        className={clsx(
          compact ? 'my-0.5' : 'my-1',
          'rounded-xl border border-amber-500/35 bg-amber-500/8 px-3 py-2.5',
        )}
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-amber-700 dark:text-amber-200">
          <ShieldAlert className="size-3.5 shrink-0" />
          <span>已被安全策略阻止</span>
        </div>
        {permissionDenied.ruleContent && (
          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] text-text-secondary">
            {permissionDenied.ruleContent}
          </pre>
        )}
        <div className="mt-2 text-[12px] leading-relaxed text-text-secondary">
          如需放行，请修改 .claude/settings.json 中的权限规则。
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        compact ? 'my-0.5' : 'my-1',
        isError
          ? 'border-l-2 border-[#b44a4a] bg-transparent pl-2.5 pr-1 py-1 dark:border-[#f2b8b8]'
          : 'py-1',
      )}
    >
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        disabled={!expandable}
        className={clsx(
          'flex w-full items-center gap-2 text-left text-[13px] text-text-secondary',
          !expandable && 'cursor-default',
        )}
      >
        <ToolStatusIcon block={block} />
        <span className={clsx('truncate', isError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
          {presentation.title}
        </span>
        {durationLabel && (
          <span className="ml-auto shrink-0 text-[11px] text-text-muted">{durationLabel}</span>
        )}
        {expandable && (
          <ChevronDown
            className={clsx(
              'ml-auto size-3.5 shrink-0 text-text-muted transition-transform',
              durationLabel && 'ml-2',
              expanded && 'rotate-180',
            )}
          />
        )}
      </button>

      {expandable && expanded && (
        <div className="mt-1 space-y-1 pl-5 text-[12.5px] leading-relaxed">
          {block.errorMessage && (
            <div className="text-[#8e3d3d] dark:text-[#f2b8b8]">{block.errorMessage}</div>
          )}
          {errorDetailText && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-text-muted">
              {errorDetailText}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
