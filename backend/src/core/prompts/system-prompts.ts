/**
 * 统一管理所有系统提示词模块
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext, ThinkingLevel } from '@webclaw/shared'
import { readPromptContextFiles, resolvePromptContextPaths, type PromptContextRole } from './context-files.js'
import { renderPromptModuleTemplate } from './prompt-module-files.js'
import { SKILLS } from '../skills/skill-loader.js'

export interface BuildSystemPromptOptions {
  readonly role: PromptContextRole
  readonly mode: SessionMode
  readonly route?: SessionRouteContext
  readonly modelId?: string | null
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly thinkingLevel?: ThinkingLevel
  readonly toolsEnabled?: boolean
  readonly extraInstructions?: string
  readonly workspaceDir?: string
}

async function buildIdentityLine(role: PromptContextRole, workspaceDir?: string): Promise<string> {
  const templateName =
    role === 'manager'
      ? 'identity-manager'
      : role === 'worker'
        ? 'identity-worker'
        : 'identity-simple'

  return await renderPromptModuleTemplate(templateName, {}, workspaceDir)
}

async function buildRoleDirectiveSection(role: PromptContextRole, workspaceDir?: string): Promise<string[]> {
  const templateName =
    role === 'manager'
      ? 'role-manager'
      : role === 'worker'
        ? 'role-worker'
        : 'role-simple'

  return toSectionLines(await renderPromptModuleTemplate(templateName, {}, workspaceDir))
}

async function buildToolingSection(
  tools: ReadonlyArray<AgentTool<any>>,
  toolsEnabled: boolean,
  workspaceDir?: string,
): Promise<string[]> {
  const toolingBody = !toolsEnabled || tools.length === 0
    ? '- 当前这一步未启用一等工具；请只基于已有上下文作答。'
    : tools
        .map((tool) => {
          const summary = tool.description?.trim() || tool.label?.trim() || '可用工具'
          return `- ${tool.name}: ${summary}`
        })
        .join('\n')

  return toSectionLines(await renderPromptModuleTemplate('tooling', { TOOLING_BODY: toolingBody }, workspaceDir))
}

async function buildToolCallStyleSection(workspaceDir?: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('tool-call-style', {}, workspaceDir))
}

async function buildSafetySection(workspaceDir?: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('safety', {}, workspaceDir))
}

async function buildSkillsSection(workspaceDir: string): Promise<string[]> {
  const skills = SKILLS.listSkillSummaries(workspaceDir)
  if (skills.length === 0) {
    return []
  }

  const skillList = skills
    .map((skill) => `- ${skill.name}: ${skill.description} (${skill.displayPath})`)
    .join('\n')

  return toSectionLines(await renderPromptModuleTemplate('skills', { SKILL_LIST: skillList }, workspaceDir))
}

async function buildWorkspaceSection(workspaceDir: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('workspace', { WORKSPACE_DIR: workspaceDir }, workspaceDir))
}

async function buildDocumentationSection(workspaceDir: string): Promise<string[]> {
  const docsRoot = path.join(workspaceDir, 'docs')
  const docsReadme = path.join(docsRoot, 'README.md')
  const backendDocs = path.join(docsRoot, 'backend')
  const backendAgents = path.join(workspaceDir, 'backend', 'AGENTS.md')
  const docLines: string[] = []

  if (existsSync(docsReadme)) {
    docLines.push(`- 项目文档入口：${docsReadme}`)
  }
  if (existsSync(backendDocs)) {
    docLines.push(`- 后端文档目录：${backendDocs}`)
  }
  if (existsSync(backendAgents)) {
    docLines.push(`- 后端开发说明：${backendAgents}`)
  }

  if (docLines.length === 0) {
    return []
  }

  return toSectionLines(
    await renderPromptModuleTemplate('documentation', { DOCUMENTATION_LINES: docLines.join('\n') }, workspaceDir),
  )
}

function formatLocalDateTime(timezone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date())
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = `${byType.year}-${byType.month}-${byType.day}`
  const time = `${byType.hour}:${byType.minute}`
  return { date, time }
}

async function buildTimeSection(route: SessionRouteContext | undefined, workspaceDir?: string): Promise<string[]> {
  const timezone = route?.userTimezone?.trim()
  if (!timezone) {
    return []
  }

  const { date, time } = formatLocalDateTime(timezone)
  return toSectionLines(
    await renderPromptModuleTemplate(
      'time',
      {
        TIME_ZONE: timezone,
        CURRENT_DATE: date,
        CURRENT_TIME: time,
      },
      workspaceDir,
    ),
  )
}

async function buildProjectContextSection(role: PromptContextRole, workspaceDir?: string): Promise<string[]> {
  const files = await readPromptContextFiles(role, workspaceDir)
  if (files.length === 0) {
    return []
  }

  const lines = ['# Project Context', '']
  const hasSoul = files.some((file) => file.path.endsWith('/SOUL.md'))
  if (hasSoul) {
    lines.push('如果存在 SOUL.md，请体现其中的人格、语气与边界，但高优先级的安全规则和角色约束始终优先。', '')
  }

  for (const file of files) {
    lines.push(`## ${file.path}`, '', file.content, '')
  }

  return lines
}

async function buildRuntimeSection(options: BuildSystemPromptOptions, workspaceDir?: string): Promise<string[]> {
  const toolsEnabled = options.toolsEnabled ?? options.tools.length > 0
  const fields = [
    `role=${options.role}`,
    `mode=${options.mode}`,
    options.route?.channel ? `channel=${options.route.channel}` : '',
    options.modelId ? `model=${options.modelId}` : '',
    `thinking=${options.thinkingLevel ?? 'off'}`,
    `toolsEnabled=${toolsEnabled ? 'true' : 'false'}`,
  ].filter(Boolean)

  return toSectionLines(
    await renderPromptModuleTemplate('runtime', { RUNTIME_FIELDS: fields.join(' | ') }, workspaceDir),
  )
}

async function buildExtraInstructionsSection(extraInstructions: string | undefined, workspaceDir?: string): Promise<string[]> {
  const trimmed = extraInstructions?.trim()
  if (!trimmed) {
    return []
  }

  return toSectionLines(
    await renderPromptModuleTemplate('extra-instructions', { EXTRA_INSTRUCTIONS: trimmed }, workspaceDir),
  )
}

export async function buildSystemPrompt(options: BuildSystemPromptOptions): Promise<string> {
  const workspaceDir = resolvePromptContextPaths(options.workspaceDir).workspaceDir
  const toolsEnabled = options.toolsEnabled ?? options.tools.length > 0

  const sections = [
    await buildIdentityLine(options.role, workspaceDir),
    '',
    ...(await buildRoleDirectiveSection(options.role, workspaceDir)),
    ...(await buildToolingSection(options.tools, toolsEnabled, workspaceDir)),
    ...(await buildToolCallStyleSection(workspaceDir)),
    ...(await buildSafetySection(workspaceDir)),
    ...(await buildSkillsSection(workspaceDir)),
    ...(await buildWorkspaceSection(workspaceDir)),
    ...(options.role === 'worker' ? [] : await buildDocumentationSection(workspaceDir)),
    ...(options.role === 'worker' ? [] : await buildTimeSection(options.route, workspaceDir)),
    ...(await buildProjectContextSection(options.role, workspaceDir)),
    ...(await buildRuntimeSection(options, workspaceDir)),
    ...(await buildExtraInstructionsSection(options.extraInstructions, workspaceDir)),
  ]

  return sections.join('\n').trim()
}

export async function buildSimpleSystemPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPrompt({ ...options, role: 'simple' })
}

export async function buildManagerPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPrompt({ ...options, role: 'manager' })
}

export async function buildWorkerPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPrompt({ ...options, role: 'worker' })
}

/** 总结节点提示词（用于 nodes.ts summarize） */
export function buildSummarizePrompt(reason: string): string {
  return `${reason}，请基于已有的对话内容，总结当前的工作进展和结果，直接回复用户。\n不要再调用任何工具。`
}

function toSectionLines(section: string): string[] {
  const trimmed = section.trim()
  if (!trimmed) return []
  return [...trimmed.split('\n'), '']
}
