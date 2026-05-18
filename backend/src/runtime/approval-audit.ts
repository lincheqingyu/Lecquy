// 中文：本文件（approval-audit.ts）位于 backend/src/runtime/approval-audit.ts，属于backend链路中的会话运行时代码，连接上游调用方与下游执行逻辑。
// English: This file (approval-audit.ts) belongs to the backend 会话运行时 layer in backend/src/runtime/approval-audit.ts, wiring upstream callers with downstream runtime logic.

import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface ApprovalAuditEntry {
  ts: number
  runId: string
  itemId: string
  toolName: string
  displayCommand?: string
  decision:
    | 'accept'
    | 'accept_for_session'
    | 'accept_for_project'
    | 'decline'
    | 'cancel'
    | 'expired'
    | 'run_cancel'
    | 'hard_deny'
  ruleContent?: string
}

export function resolveApprovalAuditPath(workspaceDir: string): string {
  return path.join(workspaceDir, '.claude', 'audit.jsonl')
}

export async function appendAuditEntry(workspaceDir: string, entry: ApprovalAuditEntry): Promise<void> {
  const targetPath = resolveApprovalAuditPath(workspaceDir)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8')
}
