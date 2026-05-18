// 中文：本文件（user-md-parser.ts）位于 backend/src/core/prompts/user-md-parser.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (user-md-parser.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/user-md-parser.ts, wiring upstream callers with downstream logic.

/**
 * USER.md 解析器：输入 USER.md 原文，输出 profile / preference 的双通道切片结果。
 *
 * 核心职责：
 * - 解析 frontmatter，并校验 schema，确保配置可控；
 * - 提取 body 的 ## Profile / ## Preference 两个业务区块；
 * - 对高风险文本进行关键词过滤，避免把行为约束混进用户偏好层；
 * - 按 startup token 预算截断，防止 system prompt 组装阶段超限。
 *
 * 调用链：
 * loadStartupSlices(context-files.ts) -> parseUserMd -> finalizeSlices
 * -> startup 层 profileSlice / preferenceSlice -> buildStartupLayerSlice / buildUserPreferenceSlice
 *
 * 设计重点：
 * - USER.md 是“稳定用户文档”，不是用户当轮消息本体；
 * - profile 描述用户背景、长期事实，进入 StartupContext；
 * - preference 描述稳定偏好，进入 UserPreference；
 * - 两者都不能升级为系统级行为指令，更不能覆盖工具权限、安全确认或项目守则；
 * - 解析失败时返回 rejected/rejectReason，由 context-files.ts 决定如何降级和记录。
 */

import { STARTUP_BUDGETS, USER_MD_SCHEMA, type UserMdSlices } from './prompt-layer-types.js'
import { estimateTokens } from './prompt-serializer.js'

// 用于过滤“语言风格”类型文本，避免注入角色行为层。
const PROFILE_BLACKLIST = /语气|风格|口吻|请用.*语气|回答要/i
// 用于过滤“越权/忽略确认”行为的 preference 风险词。
const PREFERENCE_BLACKLIST = /跳过确认|自动执行|禁用验证|忽略权限|override|bypass|sudo|绕过/i
// 简化约束：仅接受标准 frontmatter 第一段 --- ... ---。
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/
// 只识别二级标题，当前只允许 profile/preference 两类。
const H2_PATTERN = /^##\s+(.+)\s*$/gim

interface TruncateResult {
  content: string
  truncated: boolean
}

/**
 * 解析 frontmatter 为 k/v 对。解析失败只返回空对象，不抛异常；
 * 异常行被安全跳过，避免单行噪声中断整份用户配置。
 */
function parseFrontmatter(frontmatter: string): Record<string, string> {
  const metadata: Record<string, string> = {}

  for (const line of frontmatter.split('\n')) {
    // frontmatter 只支持 `key: value` 的一层结构；复杂 YAML 不在这里解析，避免引入隐式能力。
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    // 去掉简单引号，支持 schema: "lecquy.user/v1" 这类常见写法。
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '')
    metadata[key] = value
  }

  return metadata
}

/**
 * 按 token 预算做裁剪。
 * 首次按 3.5 chars/token 粗估初裁，循环向后修正到不超过预算。
 */
function truncateToBudget(content: string, tokenBudget: number): TruncateResult {
  const normalized = content.trim()
  if (!normalized) {
    return { content: '', truncated: false }
  }

  if (estimateTokens(normalized) <= tokenBudget) {
    return { content: normalized, truncated: false }
  }

  const maxChars = Math.floor(tokenBudget * 3.5)
  let truncated = normalized.slice(0, maxChars).trimEnd()

  while (truncated && estimateTokens(truncated) > tokenBudget) {
    truncated = truncated.slice(0, -1).trimEnd()
  }

  return {
    content: truncated,
    truncated: true,
  }
}

/**
 * 进行黑名单清洗 + token 截断，并汇总 rejectReason。
 * 这里不直接抛错，而是把拒绝原因带回上层，给上层统一上报。
 */
function finalizeSlices(profileSlice: string, preferenceSlice: string): UserMdSlices {
  const reasons: string[] = []
  let nextProfileSlice = profileSlice.trim()
  let nextPreferenceSlice = preferenceSlice.trim()

  // profile 只允许稳定画像；如果混入“回答风格/语气”类要求，直接丢弃该切片。
  if (nextProfileSlice && PROFILE_BLACKLIST.test(nextProfileSlice)) {
    nextProfileSlice = ''
    reasons.push('profile_blacklist')
  }

  // preference 可以描述偏好，但不能要求绕过确认、权限或验证。
  if (nextPreferenceSlice && PREFERENCE_BLACKLIST.test(nextPreferenceSlice)) {
    nextPreferenceSlice = ''
    reasons.push('preference_blacklist')
  }

  // 两个切片分别使用不同预算：profile 通常更长，preference 必须保持短而稳定。
  const profileResult = truncateToBudget(nextProfileSlice, STARTUP_BUDGETS.userProfile)
  const preferenceResult = truncateToBudget(nextPreferenceSlice, STARTUP_BUDGETS.userPreference)

  if (profileResult.truncated) {
    reasons.push('profile_truncated')
  }
  if (preferenceResult.truncated) {
    reasons.push('preference_truncated')
  }

  return {
    profileSlice: profileResult.content,
    preferenceSlice: preferenceResult.content,
    rejected: false,
    rejectReason: reasons.length > 0 ? reasons.join(',') : undefined,
  }
}

/**
 * 解析 USER.md 为 profile / preference 双切片。
 *
 * 处理顺序：
 * 1. 标准化换行并 trim；
 * 2. 解析 frontmatter，schema 不匹配直接 rejected；
 * 3. 解析 body 的 H2，超过 2 个标题 rejected；
 * 4. 将 section 映射到 profile/preference；
 * 5. finalizeSlices 清洗并返回最终结构。
 */
export function parseUserMd(raw: string): UserMdSlices {
  // 统一换行符，确保 macOS/Windows/Linux 写出的 USER.md 都产生相同解析结果。
  const normalized = raw.replace(/\r\n/g, '\n')
  const trimmed = normalized.trim()

  if (!trimmed) {
    return {
      profileSlice: '',
      preferenceSlice: '',
      rejected: false,
    }
  }

  const frontmatterMatch = normalized.match(FRONTMATTER_PATTERN)
  if (!frontmatterMatch) {
    // 兼容旧格式：没有 frontmatter 时，把整篇当作 profile 处理，而不是直接拒绝。
    return finalizeSlices(trimmed, '')
  }

  const metadata = parseFrontmatter(frontmatterMatch[1])
  if (metadata['schema'] !== USER_MD_SCHEMA) {
    // schema 不匹配说明文件结构不可被当前解析器信任，必须拒绝而不是猜测字段含义。
    return {
      profileSlice: '',
      preferenceSlice: '',
      rejected: true,
      rejectReason: 'schema_mismatch',
    }
  }

  const body = normalized.slice(frontmatterMatch[0].length).trim()
  if (!body) {
    return finalizeSlices('', '')
  }

  const headings = Array.from(body.matchAll(H2_PATTERN))
  if (headings.length > 2) {
    // 当前协议只允许 Profile/Preference 两个二级标题；额外标题可能代表未定义的指令区。
    return {
      profileSlice: '',
      preferenceSlice: '',
      rejected: true,
      rejectReason: 'extra_h2_found',
    }
  }

  let profileSlice = ''
  let preferenceSlice = ''

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    const title = heading[1]?.trim().toLowerCase()
    // section 起点是当前标题行末尾，终点是下一个标题开始；不包含标题文本本身。
    const start = (heading.index ?? 0) + heading[0].length
    const end = index + 1 < headings.length ? (headings[index + 1].index ?? body.length) : body.length
    const sectionContent = body.slice(start, end).trim()

    // 标题名严格匹配 profile/preference；未知标题不会被注入，避免扩大 USER.md 协议面。
    if (title === 'profile') {
      profileSlice = sectionContent
    }
    if (title === 'preference') {
      preferenceSlice = sectionContent
    }
  }

  return finalizeSlices(profileSlice, preferenceSlice)
}
