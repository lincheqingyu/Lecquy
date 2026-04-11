import { STARTUP_BUDGETS, USER_MD_SCHEMA, type UserMdSlices } from './prompt-layer-types.js'
import { estimateTokens } from './prompt-serializer.js'

const PROFILE_BLACKLIST = /语气|风格|口吻|请用.*语气|回答要/i
const PREFERENCE_BLACKLIST = /跳过确认|自动执行|禁用验证|忽略权限|override|bypass|sudo|绕过/i
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/
const H2_PATTERN = /^##\s+(.+)\s*$/gim

interface TruncateResult {
  content: string
  truncated: boolean
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const metadata: Record<string, string> = {}

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '')
    metadata[key] = value
  }

  return metadata
}

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

function finalizeSlices(profileSlice: string, preferenceSlice: string): UserMdSlices {
  const reasons: string[] = []
  let nextProfileSlice = profileSlice.trim()
  let nextPreferenceSlice = preferenceSlice.trim()

  if (nextProfileSlice && PROFILE_BLACKLIST.test(nextProfileSlice)) {
    nextProfileSlice = ''
    reasons.push('profile_blacklist')
  }

  if (nextPreferenceSlice && PREFERENCE_BLACKLIST.test(nextPreferenceSlice)) {
    nextPreferenceSlice = ''
    reasons.push('preference_blacklist')
  }

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
 */
export function parseUserMd(raw: string): UserMdSlices {
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
    return finalizeSlices(trimmed, '')
  }

  const metadata = parseFrontmatter(frontmatterMatch[1])
  if (metadata['schema'] !== USER_MD_SCHEMA) {
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
    const start = (heading.index ?? 0) + heading[0].length
    const end = index + 1 < headings.length ? (headings[index + 1].index ?? body.length) : body.length
    const sectionContent = body.slice(start, end).trim()

    if (title === 'profile') {
      profileSlice = sectionContent
    }
    if (title === 'preference') {
      preferenceSlice = sectionContent
    }
  }

  return finalizeSlices(profileSlice, preferenceSlice)
}
