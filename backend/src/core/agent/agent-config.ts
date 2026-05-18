// 中文：本文件（agent-config.ts）位于 backend/src/core/agent/agent-config.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (agent-config.ts) belongs to the backend agent 编排与工具链 layer in backend/src/core/agent/agent-config.ts, wiring upstream callers with downstream runtime logic.

/**
 * 代理类型配置
 * 对应源码: core/agent/agent_config.py
 * 变更：去掉 model_type 字段（统一模型）
 */

/** 代理配置 */
export interface AgentTypeConfig {
  readonly description: string
  readonly tools: readonly string[]
  readonly defaultSkills: readonly string[]
  readonly prompt: string
}

/** 已注册的代理类型 */
export const AGENT_TYPES: Record<string, AgentTypeConfig> = {
  manager: {
    description: '任务规划管理器，负责拆解任务并生成可执行 todo 计划',
    tools: ['read_file', 'skill', 'todo_write'],
    defaultSkills: [],
    prompt: '你是任务规划管理器。你不写代码，只负责规划任务并生成清晰的 todo 列表。',
  },
  worker: {
    description: '任务执行器，负责完成单个 todo 项的具体编码与验证',
    tools: ['read_file', 'bash', 'edit_file', 'write_file', 'skill'],
    defaultSkills: [],
    prompt: '你是任务执行器。你负责完成单个 todo 项并给出执行摘要。',
  },
}

/** 为系统提示词生成代理类型描述 */
export function getAgentDescriptions(): string {
  return Object.entries(AGENT_TYPES)
    .map(([name, cfg]) => `- ${name}: ${cfg.description}`)
    .join('\n')
}
