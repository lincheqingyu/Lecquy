// 中文：本文件（capability-block.ts）位于 backend/src/core/prompts/capability-block.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (capability-block.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/capability-block.ts, wiring upstream callers with downstream runtime logic.

import type { CapabilityBlock } from './prompt-layer-types.js'

/**
 * 运行时能力块生成器。
 *
 * CapabilityBlock 是 prompt builder 对“当前执行环境能做什么”的最小声明：
 * - executor 描述当前命令执行器形态，例如 shell / powershell / none；
 * - available 列出本轮可用能力，例如 bash、read_file、edit_file；
 * - unavailable 列出明确不可用能力，帮助模型不要猜测缺失工具。
 *
 * 该块通常进入 StartupContext 层，而不是直接成为工具 inventory。
 * 工具 inventory 告诉模型“可以调用哪些工具”；CapabilityBlock 告诉模型“当前环境边界是什么”。
 *
 * 同一输入必须产出同一字节输出，因为 startup 层参与缓存命中和回归对比。
 */
export function buildCapabilityBlock(cap: CapabilityBlock): string {
  // 复制后排序，避免修改调用方传入的数组，同时保证输出顺序稳定。
  const available = [...cap.available].sort()
  const unavailable = [...cap.unavailable].sort()

  // 使用显式 XML-like wrapper，方便后续 prompt 分析器或日志检索直接定位能力块。
  return [
    '<CAPABILITY>',
    // executor 单独成行，避免和 available/unavailable 混在同一个半结构化字段里。
    `executor=${cap.executor}`,
    // 数组渲染为稳定的逗号分隔形式；空数组会输出 []，表达“已知为空”。
    `available=[${available.join(', ')}]`,
    `unavailable=[${unavailable.join(', ')}]`,
    '</CAPABILITY>',
  ].join('\n')
}
