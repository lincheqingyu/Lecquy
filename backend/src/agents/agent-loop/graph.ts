/**
 * 主代理循环图编排
 * 对应源码: agents/agent_loop/graph.py
 */

import { StateGraph, END, MemorySaver } from '@langchain/langgraph'

import { AgentLoopAnnotation, type AgentLoopState } from './state.js'
import { callModel, executeTools, summarize } from './nodes.js'

const MAX_ITERATIONS = 10
const MAX_TOOL_FAILURES = 3

/** 判断是否继续执行工具 */
function shouldContinue(state: AgentLoopState): string {
  const last = state.messages[state.messages.length - 1]
  const hasToolCalls =
    'tool_calls' in last &&
    Array.isArray(last.tool_calls) &&
    last.tool_calls.length > 0

  if (!hasToolCalls) return 'end'

  if ((state.iteration ?? 0) >= MAX_ITERATIONS) {
    return 'summarize'
  }
  if ((state.toolFailCount ?? 0) >= MAX_TOOL_FAILURES) {
    return 'summarize'
  }

  return 'tools'
}

/** 工具执行后判断是否直接返回 */
function afterTools(state: AgentLoopState): string {
  if (state.directReturn) return 'end'
  return 'continue'
}

/** 创建并编译 agent_loop 图 */
function createGraph() {
  const graph = new StateGraph(AgentLoopAnnotation)
    .addNode('call_model', callModel)
    .addNode('execute_tools', executeTools)
    .addNode('summarize', summarize)
    .addEdge('__start__', 'call_model')
    .addConditionalEdges('call_model', shouldContinue, {
      tools: 'execute_tools',
      summarize: 'summarize',
      end: END,
    })
    .addConditionalEdges('execute_tools', afterTools, {
      continue: 'call_model',
      end: END,
    })
    .addEdge('summarize', END)

  const checkpointer = new MemorySaver()
  return graph.compile({ checkpointer })
}

/** 编译好的主代理循环图实例 */
export const agentLoopGraph = createGraph()
