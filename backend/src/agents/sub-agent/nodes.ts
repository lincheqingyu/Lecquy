/**
 * 子代理节点
 * 对应源码: agents/sub_agent/nodes.py
 * 变更：去掉 model_type 逻辑，统一使用 getLLM()
 */

import { AIMessage, ToolMessage, type ToolCall } from '@langchain/core/messages'

import { getLLM } from '../../core/llm/client.js'
import { SUB_TOOLS } from '../../core/tools/index.js'
import { SKILLS } from '../../core/skills/skill-loader.js'
import type { SubAgentState } from './state.js'

/** 调用 LLM 节点 */
export async function callModel(
  state: SubAgentState,
): Promise<Partial<SubAgentState>> {
  const llm = getLLM()

  // 加载 skill tools
  const extraTools = (state.extraToolNames ?? []).flatMap(
    (name: string) => SKILLS.getSkillTools(name),
  )
  const tools = [...SUB_TOOLS, ...extraTools]

  const llmWithTools = llm.bindTools(tools)
  const aiMessage = await llmWithTools.invoke(state.messages) as AIMessage

  return {
    messages: [aiMessage],
    iteration: (state.iteration ?? 0) + 1,
  }
}

/** 执行工具节点 */
export async function executeTools(
  state: SubAgentState,
): Promise<Partial<SubAgentState>> {
  const last = state.messages[state.messages.length - 1] as AIMessage
  const toolMessages: ToolMessage[] = []
  let failCount = state.toolFailCount ?? 0

  // 构建 tool_map
  const extraTools = (state.extraToolNames ?? []).flatMap(
    (name: string) => SKILLS.getSkillTools(name),
  )
  const allTools = [...SUB_TOOLS, ...extraTools]
  const toolMap = new Map(allTools.map((t) => [t.name, t]))

  for (const tc of (last.tool_calls ?? []) as ToolCall[]) {
    const { name, args, id: tool_call_id } = tc

    // skill 工具的动态工具追加
    if (name === 'skill') {
      const skillName = (args as Record<string, string>).skill_name ?? ''
      const skillTools = SKILLS.getSkillTools(skillName)
      for (const t of skillTools) {
        toolMap.set(t.name, t)
      }
    }

    let output: string
    try {
      const toolFn = toolMap.get(name)
      if (toolFn) {
        const result = await (toolFn as { invoke(args: unknown): Promise<unknown> }).invoke(args)
        output = String(result)
      } else {
        output = `未知工具: ${name}`
        failCount++
      }
    } catch (error) {
      output = `工具执行失败: ${error instanceof Error ? error.message : String(error)}`
      failCount++
    }

    toolMessages.push(
      new ToolMessage({
        content: output.slice(0, 50_000),
        tool_call_id: tool_call_id ?? '',
        name,
      }),
    )
  }

  return { messages: toolMessages, toolFailCount: failCount }
}
