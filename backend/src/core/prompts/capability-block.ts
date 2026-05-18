// 中文：本文件（capability-block.ts）位于 backend/src/core/prompts/capability-block.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (capability-block.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/capability-block.ts, wiring upstream callers with downstream runtime logic.

import type { CapabilityBlock } from './prompt-layer-types.js'

/**
 * 生成 <CAPABILITY> block 文本。
 * 同一输入必须产出同一字节输出。
 */
export function buildCapabilityBlock(cap: CapabilityBlock): string {
  const available = [...cap.available].sort()
  const unavailable = [...cap.unavailable].sort()

  return [
    '<CAPABILITY>',
    `executor=${cap.executor}`,
    `available=[${available.join(', ')}]`,
    `unavailable=[${unavailable.join(', ')}]`,
    '</CAPABILITY>',
  ].join('\n')
}
