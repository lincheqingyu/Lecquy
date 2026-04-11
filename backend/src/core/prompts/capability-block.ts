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
