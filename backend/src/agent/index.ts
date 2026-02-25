/**
 * Agent 模块统一导出
 */

export { runMainAgent, type MainAgentOptions, type MainAgentResult } from './agent-runner.js'
export { runSubAgent, runPendingTodosWithModel, type SubAgentParams } from './sub-agent-runner.js'
export { createVllmModel, type VllmModelOptions } from './vllm-model.js'
export { createAgentTools, createSubAgentTools } from './tools/index.js'
export {
  MAX_ITERATIONS,
  MAX_TOOL_FAILURES,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
  TOOL_OUTPUT_LIMIT,
  type IterationTracker,
} from './types.js'
