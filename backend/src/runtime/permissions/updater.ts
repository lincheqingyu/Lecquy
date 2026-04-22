/**
 * 权限规则更新与持久化
 *
 * 参考 Claude Code `utils/permissions/PermissionUpdate.ts`。
 * 提供三种原子操作：
 *   - addRule       添加一条规则
 *   - removeRule    按 toolName + source [+ content] 移除
 *   - clearSource   清空某个源的所有规则
 *
 * 持久化目标仅支持 `projectSettings` 和 `userSettings`，
 * session/cliArg/builtin 不落盘。
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

import { getConfigPath, loadConfigFile, normalizeRule } from './loader.js'
import type {
  PermissionConfigFile,
} from './loader.js'
import type {
  PermissionRule,
  PermissionUpdate,
  PermissionUpdateDestination,
} from './types.js'

/**
 * 应用一次更新到内存规则列表。纯函数，不落盘。
 */
export function applyUpdate(
  currentRules: PermissionRule[],
  update: PermissionUpdate,
): PermissionRule[] {
  switch (update.type) {
    case 'addRule': {
      const normalized = normalizeRule(update.rule)
      // 去重：同源、同工具、同 content 不重复
      const exists = currentRules.some(
        (r) =>
          r.source === normalized.source &&
          r.toolName === normalized.toolName &&
          (r.content ?? '') === (normalized.content ?? ''),
      )
      return exists ? currentRules : [...currentRules, normalized]
    }
    case 'removeRule': {
      return currentRules.filter(
        (r) =>
          !(
            r.source === update.source &&
            r.toolName === update.toolName &&
            (update.content === undefined || (r.content ?? '') === (update.content ?? ''))
          ),
      )
    }
    case 'clearSource': {
      return currentRules.filter((r) => r.source !== update.source)
    }
  }
}

/**
 * 批量应用更新。
 */
export function applyUpdates(
  currentRules: PermissionRule[],
  updates: PermissionUpdate[],
): PermissionRule[] {
  return updates.reduce((acc, update) => applyUpdate(acc, update), currentRules)
}

/**
 * 把某个来源的规则写入磁盘配置文件。
 *
 * 仅会覆写 `rules` 字段和可选的 `defaultMode`，其他字段保持原样。
 * 文件不存在时会自动创建目录。
 */
export async function persistRules(params: {
  destination: PermissionUpdateDestination
  rules: PermissionRule[]
  workspaceDir: string
  /** 保留的可选字段，如 defaultMode。 */
  extra?: Partial<PermissionConfigFile>
}): Promise<string> {
  const { destination, rules, workspaceDir, extra = {} } = params
  const filePath = getConfigPath(destination, workspaceDir)
  if (!filePath) {
    throw new Error(`不支持持久化到来源 "${destination}"`)
  }

  // 先读取现有文件（若存在），合并非规则字段
  let current: PermissionConfigFile = { version: '1.0' }
  try {
    const existing = await loadConfigFile(filePath, destination)
    current = {
      version: '1.0',
      defaultMode: existing.defaultMode,
    }
  } catch {
    // 解析失败时忽略原文件
  }

  const merged: PermissionConfigFile = {
    ...current,
    ...extra,
    version: '1.0',
    rules: rules
      .filter((r) => r.source === destination)
      .map(({ source: _source, ...rest }) => ({
        source: destination,
        ...rest,
      })),
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
  return filePath
}

/**
 * 一次完成：应用更新 + 持久化。
 *
 * 典型用法：用户在 UI 里点了"永久允许此命令"，我们要：
 *   1. 从内存当前规则列表中计算新的规则列表
 *   2. 把目标源（比如 projectSettings）的新规则写回磁盘
 *   3. 返回落盘路径和新规则列表
 */
export async function applyAndPersist(params: {
  currentRules: PermissionRule[]
  updates: PermissionUpdate[]
  destination: PermissionUpdateDestination
  workspaceDir: string
}): Promise<{ rules: PermissionRule[]; filePath: string }> {
  const { currentRules, updates, destination, workspaceDir } = params
  const nextRules = applyUpdates(currentRules, updates)
  const filePath = await persistRules({
    destination,
    rules: nextRules,
    workspaceDir,
  })
  return { rules: nextRules, filePath }
}
