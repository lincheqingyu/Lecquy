// 中文：本文件（skill.ts）位于 backend/src/agent/tools/skill.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (skill.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/skill.ts, wiring upstream callers with downstream runtime logic.

/**
 * Skill 工具 — 加载技能内容
 */

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { SKILLS } from '../../core/skills/skill-loader.js'

/** skill 工具的 details 类型 */
export interface SkillDetails {
  activatedSkill: string | null
}

/** 创建 skill 工具 */
export function createSkillTool(): AgentTool<typeof parameters, SkillDetails> {
  return {
    name: 'skill',
    label: '加载技能',
    description: '加载技能以获得任务的专业知识。技能内容将被注入到对话中。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<SkillDetails>> => {
      const content = SKILLS.getSkillContent(params.skill_name)
      if (content === null) {
        const available = SKILLS.listSkills().join(', ') || '无'
        return {
          content: [{ type: 'text', text: `错误：未知技能 '${params.skill_name}'。可用：${available}` }],
          details: { activatedSkill: null },
        }
      }

      const wrappedContent = `<skill-loaded name="${params.skill_name}">\n${content}\n</skill-loaded>\n\n按照上面技能中的指令完成用户的任务。`

      return {
        content: [{ type: 'text', text: wrappedContent }],
        details: { activatedSkill: params.skill_name },
      }
    },
  }
}

const parameters = Type.Object({
  skill_name: Type.String({ description: '技能名称' }),
})
