/**
 * 主代理循环节点
 * 对应源码: agents/agent_loop/nodes.py
 * 变更：去掉 model_type 逻辑和 XML tool call 解析
 */

import { AIMessage, ToolMessage, SystemMessage, type ToolCall } from '@langchain/core/messages'

import { getLLM } from '../../core/llm/client.js'
import { BASE_TOOLS, AGENT_TOOLS } from '../../core/tools/index.js'
import { setCurrentSkillNames, runPendingTodos } from '../../core/tools/agent-tools.js'
import { SKILLS } from '../../core/skills/skill-loader.js'
import { isToolResult } from '../../core/tools/tool-result.js'
import { buildSummarizePrompt } from '../../core/prompts/system-prompts.js'
import type { AgentLoopState } from './state.js'

/** skill tools 直接绑定到主图的最大数量阈值 */
const MAX_DIRECT_SKILL_TOOLS = 5

/** 调用 LLM 节点 */
export async function callModel(
  state: AgentLoopState,
): Promise<Partial<AgentLoopState>> {
  const llm = getLLM()

  // 加载 skill tools，应用阈值策略
  const extraTools = (state.extraToolNames ?? []).flatMap(
    (name: string) => SKILLS.getSkillTools(name),
  )

  const tools =
    extraTools.length <= MAX_DIRECT_SKILL_TOOLS
      ? [...AGENT_TOOLS, ...extraTools]
      : [...AGENT_TOOLS]

  const llmWithTools = llm.bindTools(tools)

  const start = performance.now()
  const aiMessage = await llmWithTools.invoke(state.messages) as AIMessage
  const elapsedMs = Math.round(performance.now() - start)

  // 提取 token 使用信息
  const usage =
    (aiMessage.response_metadata as Record<string, unknown>)?.token_usage ??
    {}

  return {
    messages: [aiMessage],
    iteration: (state.iteration ?? 0) + 1,
    elapsedMs,
    tokenUsage: usage as Record<string, number>,
  }
}

/** 执行工具节点 */
export async function executeTools(
  state: AgentLoopState,
): Promise<Partial<AgentLoopState>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage

  // 构建 tool_map
  const currentSkillNames = state.extraToolNames ?? []
  const extraTools = currentSkillNames.flatMap(
    (name: string) => SKILLS.getSkillTools(name),
  )
  const allTools = [...BASE_TOOLS, ...AGENT_TOOLS, ...extraTools]
  const toolMap = new Map(allTools.map((t) => [t.name, t]))

  const toolMessages: ToolMessage[] = []
  const newSkillNames: string[] = []
  let failCount = state.toolFailCount ?? 0

  // 设置当前 skill names，供 task 子代理使用
  setCurrentSkillNames(currentSkillNames)

  for (const toolCall of (lastMessage.tool_calls ?? []) as ToolCall[]) {
    const { name, args, id: tool_call_id } = toolCall

    // skill 工具的动态工具追加
    if (name === 'skill') {
      const skillName = (args as Record<string, string>).skill_name ?? ''
      const skillTools = SKILLS.getSkillTools(skillName)
      if (skillTools.length > 0) {
        newSkillNames.push(skillName)
        for (const t of skillTools) {
          toolMap.set(t.name, t)
        }
      }
    }

    let output: unknown
    try {
      const toolFn = toolMap.get(name)
      if (toolFn) {
        output = await (toolFn as { invoke(args: unknown): Promise<unknown> }).invoke(args)

        // todo_write 后自动执行 pending items
        if (name === 'todo_write') {
          const execSummaries: string[] = []
          for await (const [, item, result] of runPendingTodos()) {
            execSummaries.push(`### [${item.content}]\n${result}`)
          }
          if (execSummaries.length > 0) {
            output = `${String(output)}\n\n## 自动执行结果\n${execSummaries.join('\n---\n')}`
          }
        }
      } else {
        output = `未知工具: ${name}`
        failCount++
      }
    } catch (error) {
      output = `工具执行失败: ${error instanceof Error ? error.message : String(error)}`
      failCount++
    }

    // ToolResult 分离处理
    const contextContent = isToolResult(output)
      ? output.context
      : String(output)

    toolMessages.push(
      new ToolMessage({
        content: contextContent.slice(0, 50_000),
        tool_call_id: tool_call_id ?? '',
        name,
      }),
    )
  }

  const updatedNames =
    newSkillNames.length > 0
      ? [...currentSkillNames, ...newSkillNames]
      : currentSkillNames

  if (newSkillNames.length > 0) {
    setCurrentSkillNames(updatedNames)
  }

  // 判断 direct_return：所有非内置工具均属于 direct_return skill 且无失败
  const baseToolNames = new Set<string>(
    [...BASE_TOOLS, ...AGENT_TOOLS].map((t) => t.name),
  )
  const nonBuiltinTools = ((lastMessage.tool_calls ?? []) as ToolCall[])
    .map((tc: ToolCall) => tc.name)
    .filter((n: string) => !baseToolNames.has(n))

  let directReturn = false
  if (nonBuiltinTools.length > 0 && failCount === 0) {
    directReturn = nonBuiltinTools.every((tn: string) =>
      SKILLS.isDirectReturn(SKILLS.getSkillNameByTool(tn) ?? ''),
    )
  }

  return {
    messages: toolMessages,
    extraToolNames: updatedNames,
    toolFailCount: failCount,
    directReturn,
  }
}

/** 达到限制后，让 LLM 生成总结性回复 */
export async function summarize(
  state: AgentLoopState,
): Promise<Partial<AgentLoopState>> {
  let reason = ''
  if ((state.iteration ?? 0) >= 10) {
    reason = '已达到最大循环次数(10次)'
  }
  if ((state.toolFailCount ?? 0) >= 3) {
    reason = '工具调用失败次数过多(3次)'
  }

  const llm = getLLM()
  const summaryPrompt = buildSummarizePrompt(reason)
  const messages = [
    ...state.messages,
    new SystemMessage(summaryPrompt),
  ]
  const aiMessage = await llm.invoke(messages)

  return { messages: [aiMessage as AIMessage] }
}
