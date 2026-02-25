/**
 * 工具集合导出
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { createBashTool } from './bash.js'
import { createReadFileTool } from './read-file.js'
import { createSkillTool } from './skill.js'
import { createTodoWriteTool } from './todo-write.js'

/** 主 Agent 工具集（含 todoWrite） */
export function createAgentTools(): AgentTool<any>[] {
  return [createBashTool(), createReadFileTool(), createSkillTool(), createTodoWriteTool()]
}

/** 子 Agent 工具集（无 todoWrite） */
export function createSubAgentTools(): AgentTool<any>[] {
  return [createBashTool(), createReadFileTool(), createSkillTool()]
}

export { createBashTool } from './bash.js'
export { createReadFileTool } from './read-file.js'
export { createSkillTool } from './skill.js'
export { createTodoWriteTool } from './todo-write.js'
