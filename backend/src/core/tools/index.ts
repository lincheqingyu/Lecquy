/**
 * 工具统一导出
 * 对应源码: core/tools/__init__.py
 */

import { bash, readFile } from './base-tools.js'
import { skill, todoWrite } from './agent-tools.js'

/** 基础工具集 */
export const BASE_TOOLS = [bash, readFile] as const

/** 代理工具集（主图使用） */
export const AGENT_TOOLS = [skill, todoWrite] as const

/** 子代理工具集 */
export const SUB_TOOLS = [skill] as const

export { bash, readFile, skill, todoWrite }
export { type ToolResult, isToolResult, createToolResult } from './tool-result.js'
export { setCurrentSkillNames, getCurrentSkillNames, task, runPendingTodos } from './agent-tools.js'
