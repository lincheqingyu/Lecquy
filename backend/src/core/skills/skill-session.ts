import { PromptLayer, type LayerSlice } from '../prompts/prompt-layer-types.js'
import { createSlice, hashContent } from '../prompts/prompt-serializer.js'

/**
 * 会话级 Skill 常驻管理器。
 * 负责冻结单个会话内当前活跃的 skill 正文，确保 prefix cache 段字节稳定。
 */
export class SkillSession {
  private frozenSkill: {
    name: string
    content: string
    contentHash: string
  } | null = null

  /**
   * 冻结 skill 内容并返回对应的 skill layer 切片。
   */
  loadAndFreeze(name: string, content: string): LayerSlice {
    this.frozenSkill = {
      name,
      content,
      contentHash: hashContent(content),
    }

    return createSlice(PromptLayer.SkillRuntime, content, { id: name })
  }

  /**
   * 读取当前冻结 skill 的 layer 切片。
   * 没有活跃 skill 时返回空切片，序列化器会自动跳过。
   */
  getSlice(): LayerSlice {
    if (!this.frozenSkill) {
      return createSlice(PromptLayer.SkillRuntime, '')
    }

    return createSlice(
      PromptLayer.SkillRuntime,
      this.frozenSkill.content,
      { id: this.frozenSkill.name },
    )
  }

  /**
   * 当前会话是否存在已冻结的活跃 skill。
   */
  hasActiveSkill(): boolean {
    return this.frozenSkill !== null
  }

  /**
   * 返回当前活跃 skill 的名称。
   */
  getActiveSkillName(): string | null {
    return this.frozenSkill?.name ?? null
  }

  /**
   * 卸载当前会话内的冻结 skill。
   */
  unload(): void {
    this.frozenSkill = null
  }
}
