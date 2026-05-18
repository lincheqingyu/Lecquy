// 中文：本文件（prompt-serializer.ts）位于 backend/src/core/prompts/prompt-serializer.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (prompt-serializer.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/prompt-serializer.ts, wiring upstream callers with downstream runtime logic.

/**
 * LayerSlice 的序列化与 token/hash 统计模块。
 *
 * 作用：
 * 1) 把已构建好的 prompt 分层切片组装为单条 system prompt；
 * 2) 输出每层 hash/token 供缓存命中与回归比对；
 * 3) 约束只能序列化 prefix cache 层（1-5），动态段不应在该入口落盘。
 *
 * 调用关系：
 * - 上游：system-prompts.ts 的 buildLayeredSystemPrompt
 * - 下游：runtime 调度层拿到 systemPrompt + sliceHashes / sliceTokens 发送给模型 API
 *
 * 本文件是 system prompt 拼接链路的最后一站：
 * - 输入已经是结构化 LayerSlice，不再读取模板或上下文文件；
 * - serializeSystemPrompt 只接受 prefix cache 层，拒绝 MemoryRecall / LiveTurn；
 * - 输出格式统一为 `<LAYER:tag ...attrs>\ncontent\n</LAYER>`；
 * - 层顺序按 PromptLayer 数值排序，不依赖调用方传入数组顺序；
 * - sliceHashes / sliceTokens 与 systemPrompt 同源计算，用于缓存诊断和回归比较。
 *
 * 维护原则：
 * - 不要在这里根据 role/mode 添加业务文案；
 * - 不要在这里读取 `.lecquy` 文件；
 * - 不要允许动态层混入 serializeSystemPrompt，否则会破坏 prefix cache 边界；
 * - 修改标签格式前必须同步所有 prompt replay、缓存比对和日志分析代码。
 */

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

/**
 * 渲染 XML 属性值时的转义。只处理当前序列化器语义中的双引号和 &。
 * 目标：防止属性中出现非法字符导致 prompt 片段语法破坏。
 */
function escapeAttributeValue(value: string): string {
  // 属性值只需要满足当前 XML-like 标签格式，不做正文级转义；正文直接放在标签内部。
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * 将单个 layer 切片渲染为 LAYER 开标签。
 * tag 名字来自 LAYER_TAGS；attributes 为空时不额外生成空格；
 * 有属性时按 key 字典序拼接，保证字节级稳定输出。
 */
function renderLayerOpenTag(slice: LayerSlice): string {
  const attributes = slice.attributes
  if (!attributes || Object.keys(attributes).length === 0) {
    // 无属性时保持最短稳定标签，减少无意义字节差异。
    return `<LAYER:${slice.tag}>`
  }

  // 属性排序是稳定序列化的关键：对象插入顺序不应影响最终 prompt 字节。
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
  // 注：hash 与 token 在这里即时计算，便于缓存层读取 O(1) 的 metadata。
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
      // MemoryRecall / LiveTurn 必须被挡在这里，防止动态上下文污染 system prefix。
      throw new Error(`serializeSystemPrompt 仅接受 prefix cache 层，收到非法层级: ${slice.layer}`)
    }
  }

  // 排序、过滤、包标签三步必须集中在 serializer 内，调用方不能自行拼接以绕过协议。
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
  // 动态 import 解决 system-prompts.ts 与 prompt-serializer.ts 之间的循环依赖：
  // system-prompts.ts 需要 createSlice，serializer 又需要调用各层 builder。
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

  // 构建顺序写成显式数组，便于对照 PromptLayer；最终字节顺序仍由 serializeSystemPrompt 排序保证。
  const slices = [
    await buildSystemLayerSlice(options),
    await buildModeLayerSlice(options),
    await buildStartupLayerSlice(options),
    skillSlice,
    await buildUserPreferenceSlice(options),
  ]

  // 关键序列：系统/模式/启动/skill/user_preference，按层级排序后再拼接，确保稳定字节流。
  const systemPrompt = serializeSystemPrompt(slices)
  // hash/token 与 slices 同步生成，调用方可以不解析 systemPrompt 也能做缓存观察。
  const sliceHashes = Object.fromEntries(slices.map((slice) => [slice.tag, slice.contentHash]))
  const sliceTokens = Object.fromEntries(slices.map((slice) => [slice.tag, slice.tokenEstimate]))

  return {
    systemPrompt,
    sliceHashes,
    sliceTokens,
  }
}
