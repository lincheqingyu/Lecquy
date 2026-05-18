// 中文：本文件（prompt-module-files.ts）位于 backend/src/core/prompts/prompt-module-files.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (prompt-module-files.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/prompt-module-files.ts, wiring upstream callers with downstream runtime logic.

/**
 * 系统 prompt 模块文件加载器。
 *
 * 本文件只负责“模板文件清单 + 模板读取 + 占位符渲染”三件事：
 * - 模板清单：PromptTemplateName 和 TEMPLATE_FILENAMES 定义哪些模块可被 system-prompts.ts 调用；
 * - 读取策略：优先读取 `.lecquy/system-prompt/*.md` 中的用户/项目覆盖模板；
 * - 兜底策略：磁盘模板不存在或读取失败时使用 DEFAULT_TEMPLATES，保证 prompt builder 不因缺文件中断；
 * - 渲染策略：只做 `{{PLACEHOLDER}}` 级别的纯字符串替换，不执行 Markdown、JS、表达式或递归模板逻辑。
 *
 * 与其他文件的边界：
 * - context-files.ts 负责解析 `.lecquy` 根路径，本文件只复用 resolvePromptContextPaths；
 * - system-prompts.ts 负责决定“什么时候渲染哪个模板”，本文件不判断角色和模式；
 * - prompt-serializer.ts 负责最终 LAYER 包裹和排序，本文件只返回单个模板渲染后的正文。
 *
 * 维护注意：
 * - 新增模板时必须同时更新 PromptTemplateName、TEMPLATE_FILENAMES、DEFAULT_TEMPLATES；
 * - DEFAULT_TEMPLATES 是可运行兜底，不是主配置来源，正式覆盖应写入 `.lecquy/system-prompt/`；
 * - 占位符命名统一使用大写下划线，便于最后的未替换占位符清理正则识别。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolvePromptContextPaths } from './context-files.js'

/** system-prompts.ts 可请求渲染的模板名白名单。 */
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

export const PROMPT_TEMPLATE_NAMES = Object.keys(TEMPLATE_FILENAMES).sort() as PromptTemplateName[]

/**
 * 内置默认模板。
 *
 * 这些文本保证 Lecquy 即使没有 `.lecquy/system-prompt/*.md` 也能构造可用 system prompt。
 * 它们有两个设计约束：
 * - 内容尽量短，避免默认兜底把 prompt 变成不可维护的大块文案；
 * - 每个模板只表达一个 section，避免 system-prompts.ts 无法按层级组合。
 */
const DEFAULT_TEMPLATES: Record<PromptTemplateName, string> = {
  'identity-simple': '你是运行在 Lecquy 中的个人助手，负责直接完成用户请求或通过工具推进任务。\n',
  'identity-manager': '你是运行在 Lecquy 中的任务规划管理器，负责把用户目标拆成清晰、可执行的计划。\n',
  'identity-worker': '你是运行在 Lecquy 中的任务执行器，负责完成单个任务并返回可靠结果。\n',
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
    '- 需要生成交付给用户的文档、页面、导出文件时，默认写入 `.lecquy/artifacts/docs/`，除非用户明确指定了其它路径。',
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
    '- 遇到 Lecquy 行为、架构、配置或约定相关问题时，优先查本地文档再回答。',
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
    // 只在成功读取时返回内容；任何文件不存在、权限不足或瞬时 IO 错误都降级为空串。
    return await fs.readFile(filePath, 'utf8')
  } catch {
    // 这里刻意吞掉错误：模板覆盖是可选能力，缺模板不能阻断主 agent loop。
    return ''
  }
}

function resolveTemplateDir(workspaceDir?: string): string {
  // 模板目录挂在 `.lecquy/system-prompt` 下，rootDir 的解析规则集中在 context-files/runtime-paths 链路。
  const { rootDir } = resolvePromptContextPaths(workspaceDir)
  return path.join(rootDir, 'system-prompt')
}

function resolveTemplatePath(name: PromptTemplateName, workspaceDir?: string): string {
  // name 已被 PromptTemplateName 限定为白名单，因此这里不会拼接任意用户输入路径。
  return path.join(resolveTemplateDir(workspaceDir), TEMPLATE_FILENAMES[name])
}

export async function ensurePromptModuleTemplates(workspaceDir?: string): Promise<void> {
  // 当前只确保目录存在，不主动写默认模板，避免覆盖用户已经维护的 prompt 文件。
  const templateDir = resolveTemplateDir(workspaceDir)
  await fs.mkdir(templateDir, { recursive: true })
}

export async function readPromptModuleTemplate(name: PromptTemplateName, workspaceDir?: string): Promise<string> {
  // 优先读取磁盘模板，允许项目按需覆盖默认 prompt section。
  const filePath = resolveTemplatePath(name, workspaceDir)
  const content = await readTextIfExists(filePath)
  // 空文件也会回退默认模板；如果未来需要“显式清空模板”，应新增独立语义而不是复用空文件。
  return content || DEFAULT_TEMPLATES[name]
}

export async function renderPromptModuleTemplate(
  name: PromptTemplateName,
  replacements: Record<string, string>,
  workspaceDir?: string,
): Promise<string> {
  const template = await readPromptModuleTemplate(name, workspaceDir)
  let rendered = template

  // 只替换调用方明确传入的占位符，避免模板文件具备执行能力。
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value)
  }

  // 未填充的大写占位符统一清空，避免把 `{{FOO}}` 泄漏到最终 system prompt。
  rendered = rendered.replace(/\{\{[A-Z0-9_]+\}\}/g, '')
  // 多个 section 组合时容易产生三连空行；这里先在模板级做一次收敛。
  rendered = rendered.replace(/\n{3,}/g, '\n\n')
  // 返回不带首尾空白的正文，最终换行边界由 system-prompts / serializer 统一决定。
  return rendered.trim()
}
