// 中文：本文件（permission-manager-registry.ts）位于 backend/src/agent/permission-manager-registry.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (permission-manager-registry.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/permission-manager-registry.ts, wiring upstream callers with downstream runtime logic.

/**
 * 权限管理器注册表（Permission Manager Registry）
 *
 * 为每个工作区维护一个共享的 `PermissionManager` 实例，避免 runner 每次都
 * 重新加载配置文件。
 *
 * 使用 `LAYERED_PROMPT` 环境变量做门闸：
 *   - `LAYERED_PROMPT === 'true'`：返回（或首次创建）该工作区的 Manager
 *   - 其他值：返回 undefined，调用方走旧引擎
 *
 * 默认模式通过 `LECQUY_PERMISSION_MODE` 控制，合法值见 `PERMISSION_MODES`。
 * 无效值会被静默忽略，退化为 `default`。
 *
 * 启动阶段 Manager 加载失败时返回 undefined 并在 stderr 输出一条警告，
 * 以避免整个 agent runner 因权限系统异常而崩溃（降级到旧引擎）。
 */

import {
  isPermissionMode,
  PermissionManager,
  type PermissionMode,
} from '../runtime/permissions/index.js'

/**
 * workspaceDir → Promise<PermissionManager | null> 的映射。
 *
 * 存 Promise 而非已解析实例，避免并发 get 导致重复创建。
 * null 表示创建过但失败，不再重试（直到进程重启）。
 */
const managerByWorkspace = new Map<string, Promise<PermissionManager | null>>()

function parseInitialMode(): PermissionMode | undefined {
  const raw = process.env.LECQUY_PERMISSION_MODE
  if (!raw) return undefined
  return isPermissionMode(raw) ? raw : undefined
}

/**
 * 获取（或首次创建）指定工作区的 `PermissionManager`。
 *
 * - `LAYERED_PROMPT` 未启用：直接返回 undefined，调用方走旧引擎
 * - Manager 创建失败：记录警告，返回 undefined
 * - 成功：返回共享实例
 */
export async function getPermissionManager(
  workspaceDir: string,
): Promise<PermissionManager | undefined> {
  const enabled = process.env.LAYERED_PROMPT === 'true'
  if (!enabled) return undefined

  const existing = managerByWorkspace.get(workspaceDir)
  if (existing) {
    const resolved = await existing
    return resolved ?? undefined
  }

  const pending = (async (): Promise<PermissionManager | null> => {
    try {
      const manager = await PermissionManager.create({
        workspaceDir,
        initialMode: parseInitialMode(),
      })
      return manager
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // eslint-disable-next-line no-console
      console.warn(
        `[permissions] 工作区 ${workspaceDir} 的 PermissionManager 创建失败，` +
          `降级到旧引擎：${message}`,
      )
      return null
    }
  })()

  managerByWorkspace.set(workspaceDir, pending)
  const resolved = await pending
  return resolved ?? undefined
}

/**
 * 强制清除某个工作区的缓存（测试/热重载用）。
 */
export function clearPermissionManagerCache(workspaceDir?: string): void {
  if (workspaceDir) {
    managerByWorkspace.delete(workspaceDir)
    return
  }
  managerByWorkspace.clear()
}
