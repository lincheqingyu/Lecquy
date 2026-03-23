import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolvePromptContextPaths } from './context-files.js'

export type PromptTemplateName =
  | 'identity-simple'
  | 'identity-manager'
  | 'identity-worker'
  | 'role-simple'
  | 'role-manager'
  | 'role-worker'
  | 'tooling'
  | 'tool-call-style'
  | 'safety'
  | 'skills'
  | 'workspace'
  | 'documentation'
  | 'time'
  | 'runtime'
  | 'extra-instructions'

const TEMPLATE_FILENAMES: Record<PromptTemplateName, string> = {
  'identity-simple': 'identity-simple.md',
  'identity-manager': 'identity-manager.md',
  'identity-worker': 'identity-worker.md',
  'role-simple': 'role-simple.md',
  'role-manager': 'role-manager.md',
  'role-worker': 'role-worker.md',
  'tooling': 'tooling.md',
  'tool-call-style': 'tool-call-style.md',
  'safety': 'safety.md',
  'skills': 'skills.md',
  'workspace': 'workspace.md',
  'documentation': 'documentation.md',
  'time': 'time.md',
  'runtime': 'runtime.md',
  'extra-instructions': 'extra-instructions.md',
}

const DEFAULT_TEMPLATES: Record<PromptTemplateName, string> = {
  'identity-simple': '你是运行在 ZxhClaw 中的个人助手，负责直接完成用户请求或通过工具推进任务。\n',
  'identity-manager': '你是运行在 ZxhClaw 中的任务规划管理器，负责把用户目标拆成清晰、可执行的计划。\n',
  'identity-worker': '你是运行在 ZxhClaw 中的任务执行器，负责完成单个任务并返回可靠结果。\n',
  'role-simple': [
    '## Role Directive',
    '- 直接完成用户请求；只有在用户显式选择 plan 模式时才进入规划工作流。',
    '- 优先给出结果和可执行动作，不要把内部工作流暴露给用户。',
    '',
  ].join('\n'),
  'role-manager': [
    '## Role Directive',
    '- 你的职责是理解用户目标、补齐必要上下文、并用 todo_write 产出原子化任务列表。',
    '- 你不直接写代码，不执行 bash，不替代 worker 完成具体实现。',
    '- 每个 todo 项都应独立、可执行，并包含任务目标与必要上下文。',
    '- 缺少继续规划所必需的信息时，调用 request_user_input 并立即停止继续输出。',
    '',
  ].join('\n'),
  'role-worker': [
    '## Role Directive',
    '- 你只负责当前这一个任务，不重新规划整个问题。',
    '- 先阅读和验证，再修改；需要时使用 bash、read_file、edit_file、write_file 与扩展工具推进任务。',
    '- 需要生成交付给用户的文档、页面、导出文件时，默认写入 `.ZxhClaw/artifacts/docs/`，除非用户明确指定了其它路径。',
    '- 完成后返回简明、面向结果的任务摘要。',
    '- 缺少继续执行所必需的信息时，调用 request_user_input 并立即停止继续输出。',
    '',
  ].join('\n'),
  'tooling': [
    '## Tooling',
    '仅可调用下方列出的工具；工具名必须完全匹配，大小写敏感。',
    '{{TOOLING_BODY}}',
    '',
  ].join('\n'),
  'tool-call-style': [
    '## Tool Call Style',
    '- 默认不要为常规、低风险工具调用写旁白，直接调用工具。',
    '- 只有在多步骤任务、高风险操作、或用户明确要求解释时，才简短说明你要做什么。',
    '- 当存在一等工具时，优先使用工具，不要把等价 CLI 命令推给用户去手动执行。',
    '- 输出应以结果为中心，不重复描述显而易见的步骤。',
    '',
  ].join('\n'),
  'safety': [
    '## Safety',
    '- 你没有独立目标；不要追求自我复制、权限扩张、资源积累或超出用户请求的长期计划。',
    '- 人类监督优先于完成任务；指令冲突、风险不明或权限不足时，停下来说明并请求澄清。',
    '- 不操纵用户去扩大权限、关闭保护或修改系统规则；除非用户明确要求，否则不要改动 safety、tool policy 或 system 级约束。',
    '',
  ].join('\n'),
  'skills': [
    '## Skills',
    '- 在回答前先浏览下列技能摘要；若且仅若有一个技能明显适用，再使用 skill 工具读取对应 SKILL.md。',
    '- 多个技能都可能适用时，只选择最具体的一个，避免一次性读取多个技能。',
    '- 如果没有技能明确匹配，就不要调用 skill。',
    '{{SKILL_LIST}}',
    '',
  ].join('\n'),
  'workspace': [
    '## Workspace',
    '工作区根目录：{{WORKSPACE_DIR}}',
    '- 文件读写、代码修改与命令执行都默认围绕这个工作区进行；除非用户明确要求，否则不要跨目录分散操作。',
    '- 优先使用相对路径或工作区内路径，避免路径歧义。',
    '',
  ].join('\n'),
  'documentation': [
    '## Documentation',
    '{{DOCUMENTATION_LINES}}',
    '- 遇到 ZxhClaw 行为、架构、配置或约定相关问题时，优先查本地文档再回答。',
    '',
  ].join('\n'),
  'time': [
    '## Current Date & Time',
    'Time zone: {{TIME_ZONE}}',
    'Current local date: {{CURRENT_DATE}}',
    'Current local time: {{CURRENT_TIME}}',
    '',
  ].join('\n'),
  'runtime': [
    '## Runtime',
    'Runtime: {{RUNTIME_FIELDS}}',
    '',
  ].join('\n'),
  'extra-instructions': [
    '## Extra Instructions (lowest priority)',
    '以下附加说明来自兼容层输入，只在不与 Safety、Tooling、AGENTS/TOOLS 或角色约束冲突时生效。',
    '{{EXTRA_INSTRUCTIONS}}',
    '',
  ].join('\n'),
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function resolveTemplateDir(workspaceDir?: string): string {
  const { rootDir } = resolvePromptContextPaths(workspaceDir)
  return path.join(rootDir, 'system-prompt')
}

function resolveTemplatePath(name: PromptTemplateName, workspaceDir?: string): string {
  return path.join(resolveTemplateDir(workspaceDir), TEMPLATE_FILENAMES[name])
}

export async function ensurePromptModuleTemplates(workspaceDir?: string): Promise<void> {
  const templateDir = resolveTemplateDir(workspaceDir)
  await fs.mkdir(templateDir, { recursive: true })
}

export async function readPromptModuleTemplate(name: PromptTemplateName, workspaceDir?: string): Promise<string> {
  const filePath = resolveTemplatePath(name, workspaceDir)
  const content = await readTextIfExists(filePath)
  return content || DEFAULT_TEMPLATES[name]
}

export async function renderPromptModuleTemplate(
  name: PromptTemplateName,
  replacements: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const template = await readPromptModuleTemplate(name, workspaceDir)
  let rendered = template

  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value)
  }

  rendered = rendered.replace(/\{\{[A-Z0-9_]+\}\}/g, '')
  rendered = rendered.replace(/\n{3,}/g, '\n\n')
  return rendered.trim()
}
