// 中文：本文件（index.ts）位于 backend/src/agent/index.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/index.ts, wiring upstream callers with downstream runtime logic.

/**
 * Agent 模块统一导出
 */

export { runSimpleAgent, type SimpleAgentOptions, type SimpleAgentResult, type TurnState } from './agent-runner.js'
export {
  runManagerAgent,
  handleWorkerReceipt,
  type ManagerAgentOptions,
  type ManagerAgentResult,
  type ManagerDecision,
} from './manager-runner.js'
export {
  runWorkerAgent,
  type WorkerAgentOptions,
  type WorkerAgentResult,
  type WorkerRunOptions,
  type WorkerResult,
} from './worker-runner.js'
export { createVllmModel, type VllmModelOptions } from './vllm-model.js'
export { createSimpleTools, createManagerTools, createWorkerTools } from './tools/index.js'
export {
  classifyToolPermission,
  createPermissionAwareTools,
  isCoreAgentEvent,
  isManagerAllowed,
  isWorkerAllowed,
  type AgentRuntimeEvent,
  type ConfirmRequiredEvent,
  type PreambleEvent,
} from './tool-permission.js'
export {
  getPermissionManager,
  clearPermissionManagerCache,
} from './permission-manager-registry.js'
export {
  AgentExecutionError,
  MAX_ITERATIONS,
  MAX_TOOL_FAILURES,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
  TOOL_OUTPUT_LIMIT,
  type IterationTracker,
} from './types.js'
