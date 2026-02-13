/**
 * 子代理图编排
 * 对应源码: agents/sub_agent/graph.py
 */

import { StateGraph, END } from '@langchain/langgraph'

import { SubAgentAnnotation, type SubAgentState } from './state.js'
import { callModel, executeTools } from './nodes.js'

const MAX_SUB_ITERATIONS = 8
const MAX_SUB_TOOL_FAILURES = 3

/** 判断是否继续执行 */
function shouldContinue(state: SubAgentState): string {
  const last = state.messages[state.messages.length - 1]
  const hasToolCalls =
    'tool_calls' in last &&
    Array.isArray(last.tool_calls) &&
    last.tool_calls.length > 0

  if (!hasToolCalls) return 'end'

  if ((state.iteration ?? 0) >= (state.maxIterations ?? MAX_SUB_ITERATIONS)) {
    return 'limit'
  }

  if ((state.toolFailCount ?? 0) >= MAX_SUB_TOOL_FAILURES) {
    return 'limit'
  }

  return 'tools'
}

/** 创建子代理子图并编译返回 */
export function createSubGraph() {
  const graph = new StateGraph(SubAgentAnnotation)
    .addNode('call_model', callModel)
    .addNode('execute_tools', executeTools)
    .addEdge('__start__', 'call_model')
    .addConditionalEdges('call_model', shouldContinue, {
      tools: 'execute_tools',
      end: END,
      limit: END,
    })
    .addEdge('execute_tools', 'call_model')

  return graph.compile()
}
