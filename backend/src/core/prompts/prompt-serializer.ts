import { createHash } from 'node:crypto'
import {
  type BuildLayeredPromptOptions,
  type LayeredPromptResult,
  LAYER_TAGS,
  type LayerSlice,
  PREFIX_CACHE_LAYERS,
  type PromptLayer,
} from './prompt-layer-types.js'
import type { SkillSession } from '../skills/skill-session.js'

const PREFIX_CACHE_LAYER_SET = new Set<PromptLayer>(PREFIX_CACHE_LAYERS)

function escapeAttributeValue(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function renderLayerOpenTag(slice: LayerSlice): string {
  const attributes = slice.attributes
  if (!attributes || Object.keys(attributes).length === 0) {
    return `<LAYER:${slice.tag}>`
  }

  const renderedAttributes = Object.keys(attributes)
    .sort()
    .map((key) => `${key}="${escapeAttributeValue(attributes[key] ?? '')}"`)
    .join(' ')

  return `<LAYER:${slice.tag} ${renderedAttributes}>`
}

/**
 * 计算内容的 SHA256 哈希。
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 粗估 token 数。
 * 按 1 token ≈ 3.5 字符估算，并向上取整。
 */
export function estimateTokens(content: string): number {
  const normalizedLength = content.length
  return normalizedLength === 0 ? 0 : Math.ceil(normalizedLength / 3.5)
}

/**
 * 构建单个 LayerSlice。
 * tag、hash 与 tokenEstimate 都基于当前内容自动生成。
 */
export function createSlice(
  layer: PromptLayer,
  content: string,
  attributes?: Record<string, string>,
): LayerSlice {
  return {
    layer,
    tag: LAYER_TAGS[layer],
    content,
    contentHash: hashContent(content),
    tokenEstimate: estimateTokens(content),
    attributes,
  }
}

/**
 * 将多个 prefix cache 层切片序列化为单条 system prompt。
 * 同一输入必须产出同一字节输出。
 */
export function serializeSystemPrompt(slices: LayerSlice[]): string {
  for (const slice of slices) {
    if (!PREFIX_CACHE_LAYER_SET.has(slice.layer)) {
      throw new Error(`serializeSystemPrompt 仅接受 prefix cache 层，收到非法层级: ${slice.layer}`)
    }
  }

  return [...slices]
    .sort((left, right) => left.layer - right.layer)
    .filter((slice) => slice.content.trim().length > 0)
    .map((slice) => {
      const openTag = renderLayerOpenTag(slice)
      return `${openTag}\n${slice.content}\n</LAYER>`
    })
    .join('\n\n')
}

/**
 * 构建并序列化分层 system prompt。
 */
export async function buildLayeredSystemPrompt(
  options: BuildLayeredPromptOptions,
  skillSession?: SkillSession,
): Promise<LayeredPromptResult> {
  const {
    buildModeLayerSlice,
    buildSkillLayerSlice,
    buildStartupLayerSlice,
    buildSystemLayerSlice,
    buildUserPreferenceSlice,
  } = await import('./system-prompts.js')

  const skillSlice = skillSession
    ? skillSession.getSlice()
    : await buildSkillLayerSlice(options)

  const slices = [
    await buildSystemLayerSlice(options),
    await buildModeLayerSlice(options),
    await buildStartupLayerSlice(options),
    skillSlice,
    await buildUserPreferenceSlice(options),
  ]

  const systemPrompt = serializeSystemPrompt(slices)
  const sliceHashes = Object.fromEntries(slices.map((slice) => [slice.tag, slice.contentHash]))
  const sliceTokens = Object.fromEntries(slices.map((slice) => [slice.tag, slice.tokenEstimate]))

  return {
    systemPrompt,
    sliceHashes,
    sliceTokens,
  }
}
