/**
 * 新权限引擎 ↔ 旧 PermissionTier 桥接
 *
 * Lecquy 现有的 `agent/tool-permission.ts` 使用三档 `PermissionTier`：
 *   - Auto     直接执行
 *   - Preamble 先说明后执行
 *   - Confirm  必须等待显式确认
 *
 * 而新的权限引擎输出四档 `PermissionBehavior`：
 *   - allow / deny / ask / plan
 *
 * 本模块把新决策翻译为旧 Tier，保证现有调用方（尤其是
 * `createPermissionAwareTools`）的调用路径无需修改即可受益于新规则引擎。
 *
 * 翻译语义：
 *   allow → Auto        直接放行
 *   ask   → Confirm     阻塞等用户确认
 *   plan  → Confirm     plan 模式下等同于要求用户看一眼再定
 *   deny  → Confirm     deny 也要告诉用户"被拦了"，由上层决定是否拒绝交互
 *
 * 特别地，如果 checker 已经返回 deny，调用方应优先按 deny 处理，
 * 不要走 Confirm 的"等待用户"路径——本模块同时暴露 `isHardDeny` 便于区分。
 */

import { PermissionTier } from '../../core/prompts/prompt-layer-types.js'
import type { PermissionDecision, PermissionResult } from './types.js'

/**
 * 将新决策翻译为 Tier。
 */
export function decisionToTier(decision: PermissionDecision): PermissionTier {
  switch (decision.behavior) {
    case 'allow':
      return PermissionTier.Auto
    case 'deny':
      return PermissionTier.Confirm
    case 'ask':
      return PermissionTier.Confirm
    case 'plan':
      return PermissionTier.Confirm
  }
}

/**
 * 判断决策是否为"硬拒绝"。
 *
 * 上层在 createPermissionAwareTools 里收到 hardDeny 应直接抛错，
 * 而不是走 Confirm 的 "等待用户确认" 流程。
 */
export function isHardDeny(decision: PermissionDecision): boolean {
  return decision.behavior === 'deny'
}

/**
 * 是否要走 Preamble（先说明后执行）。
 *
 * 新引擎不直接产生 Preamble 语义——Preamble 对应
 * "操作较重但不需要阻塞用户"，相当于 allow + 通知。
 * 我们把以下两类视为 Preamble：
 *   1. behavior=allow 且 matchedRule 来自 cliArg/session（用户临时放行）
 *   2. behavior=allow 但 preCheck 给过 ask（被 acceptEdits 等模式放行）
 */
export function shouldUsePreamble(result: PermissionResult): boolean {
  if (result.decision.behavior !== 'allow') return false
  const reason = result.decision.reason
  return (
    reason.includes('acceptEdits') ||
    reason.includes('cliArg') ||
    reason.includes('session')
  )
}

/**
 * 完整翻译：返回 Tier 与辅助信息。
 */
export interface BridgedTier {
  tier: PermissionTier
  hardDeny: boolean
  /** 面向 UI 的描述文本。 */
  description: string
  reason: string
}

export function bridgeResult(result: PermissionResult): BridgedTier {
  const { decision } = result
  const hardDeny = isHardDeny(decision)
  const tier = hardDeny
    ? PermissionTier.Confirm
    : shouldUsePreamble(result)
      ? PermissionTier.Preamble
      : decisionToTier(decision)

  const description = hardDeny
    ? `操作已被拒绝：${decision.reason}`
    : decision.behavior === 'ask'
      ? `需要用户确认：${decision.reason}`
      : decision.behavior === 'plan'
        ? `计划模式：${decision.reason}（仅预览）`
        : decision.reason

  return {
    tier,
    hardDeny,
    description,
    reason: decision.reason,
  }
}
