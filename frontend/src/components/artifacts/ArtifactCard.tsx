// 中文：本文件（ArtifactCard.tsx）位于 frontend/src/components/artifacts/ArtifactCard.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (ArtifactCard.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/artifacts/ArtifactCard.tsx, wiring upstream callers with downstream runtime logic.

import { Download, FileCode2, LoaderCircle } from 'lucide-react'
import { FileCardShell } from '../files/FileCardShell'
import { formatBytes, inferArtifactTypeLabel } from '../../lib/file-display'
import type { ChatArtifact } from '../../lib/artifacts'

interface ArtifactCardProps {
  artifact: ChatArtifact
  active?: boolean
  onOpen?: () => void
  onDownload?: () => void
}

export function ArtifactCard({ artifact, active = false, onOpen, onDownload }: ArtifactCardProps) {
  const isDraft = artifact.status === 'draft'

  return (
    <FileCardShell
      title={artifact.name}
      meta={`${inferArtifactTypeLabel(artifact)} · ${formatBytes(artifact.size)}${isDraft ? ' · 生成中' : ''}`}
      icon={<FileCode2 className="size-4.5" />}
      active={active}
      onClick={onOpen}
      action={(
        isDraft ? (
          <div className="inline-flex h-11 items-center justify-center rounded-2xl border border-border/70 bg-surface-alt px-4 text-sm font-medium text-text-secondary dark:border-[#5a5a55] dark:bg-[rgb(31,32,35)] dark:text-[#d6d3cc]">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            生成中
          </div>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDownload?.()
            }}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-white px-4 text-sm font-medium text-text-primary transition-colors hover:bg-hover dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:text-[#f3f1ea] dark:hover:border-black dark:hover:bg-black dark:hover:text-white"
          >
            <Download className="mr-2 size-4" />
            Download
          </button>
        )
      )}
      className="bg-white"
    />
  )
}
