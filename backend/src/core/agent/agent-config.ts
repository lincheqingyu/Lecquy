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
  query: {
    description: '用于执行数据查询任务的代理，可调用 SQL 查询、API 接口等技能工具',
    tools: ['skill'],
    defaultSkills: ['query_cadre_basic_info', 'get_ai_archive'],
    prompt: '你是一个数据查询代理。使用已加载的技能工具（如 SQL 查询、API 调用）高效获取数据，返回清晰的查询结果。',
  },
  analyze: {
    description: '用于分析和整合多源数据、生成报告的代理',
    tools: ['skill'],
    defaultSkills: [],
    prompt: '你是一个数据分析代理。基于提供的数据进行分析、对比、汇总，输出结构化的分析结果。',
  },
}

/** 为系统提示词生成代理类型描述 */
export function getAgentDescriptions(): string {
  return Object.entries(AGENT_TYPES)
    .map(([name, cfg]) => `- ${name}: ${cfg.description}`)
    .join('\n')
}
