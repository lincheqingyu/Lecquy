/**
 * 技能加载器
 * 对应源码: core/skills/skill_loader.py
 * 变更：去掉 model_type、动态工具加载（TypeScript 不支持像 Python 的 importlib 动态加载 @tool）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { resolveRuntimePaths } from '../runtime-paths.js'

/** 解析后的技能数据 */
export interface Skill {
  readonly name: string
  readonly description: string
  readonly directReturn: boolean
  readonly body: string
  readonly path: string
  readonly dir: string
}

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly path: string
}

class SkillLoader {
  private readonly skillsDir: string
  private readonly skills: Map<string, Skill> = new Map()

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir
    this.loadSkills()
  }

  /** 解析 SKILL.md 文件为元数据和正文 */
  private parseSkillMd(filePath: string): Skill | null {
    const content = readFileSync(filePath, 'utf-8')

    // 匹配 YAML 前置
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
    if (!match) return null

    const [, frontmatter, body] = match

    // 解析元数据
    const metadata: Record<string, string> = {}
    for (const line of frontmatter.trim().split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
        metadata[key] = value
      }
    }

    if (!metadata['name'] || !metadata['description']) return null

    const directReturnRaw = metadata['direct_return'] ?? 'false'
    const directReturn = ['true', '1', 'yes'].includes(directReturnRaw.toLowerCase())

    return {
      name: metadata['name'],
      description: metadata['description'],
      directReturn,
      body: body.trim(),
      path: filePath,
      dir: resolve(filePath, '..'),
    }
  }

  /** 扫描目录并加载所有有效的 SKILL.md 文件 */
  private loadSkills(): void {
    if (!existsSync(this.skillsDir)) return

    for (const entry of readdirSync(this.skillsDir)) {
      const dirPath = join(this.skillsDir, entry)
      if (!statSync(dirPath).isDirectory()) continue

      const skillMd = join(dirPath, 'SKILL.md')
      if (!existsSync(skillMd)) continue

      const skill = this.parseSkillMd(skillMd)
      if (skill) {
        this.skills.set(skill.name, skill)
      }
    }
  }

  /** 生成系统提示的技能描述 */
  getDescriptions(): string {
    if (this.skills.size === 0) return '(没有可用的技能)'

    return Array.from(this.skills.entries())
      .map(([name, skill]) => `- ${name}: ${skill.description}`)
      .join('\n')
  }

  /** 获取完整技能内容 */
  getSkillContent(name: string): string | null {
    const skill = this.skills.get(name)
    if (!skill) return null

    let content = `# Skill: ${skill.name}\n\n${skill.body}`

    // 列出可用资源
    const resources: string[] = []
    for (const [folder, label] of [
      ['scripts', '脚本'],
      ['references', '参考资料'],
      ['assets', '资源文件'],
    ] as const) {
      const folderPath = join(skill.dir, folder)
      if (existsSync(folderPath)) {
        const files = readdirSync(folderPath)
        if (files.length > 0) {
          resources.push(`${label}: ${files.join(', ')}`)
        }
      }
    }

    if (resources.length > 0) {
      content += `\n\n**${skill.dir} 中的可用资源：**\n`
      content += resources.map((r) => `- ${r}`).join('\n')
    }

    return content
  }

  /** 获取技能工具列表（当前不支持动态工具加载，返回空数组） */
  getSkillTools(_name: string): AgentTool[] {
    return []
  }

  /** 判断指定 skill 是否标记了 direct_return */
  isDirectReturn(skillName: string): boolean {
    return this.skills.get(skillName)?.directReturn ?? false
  }

  /** 通过工具名反查所属 skill 名称（当前无动态工具，始终返回 null） */
  getSkillNameByTool(_toolName: string): string | null {
    return null
  }

  /** 返回可用技能名称列表 */
  listSkills(): string[] {
    return Array.from(this.skills.keys())
  }

  /** 返回技能摘要列表，供系统提示词生成器使用 */
  listSkillSummaries(): SkillSummary[] {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
    }))
  }
}

/** 获取技能目录路径（backend/skills） */
function getSkillsDir(): string {
  return resolveRuntimePaths().backendSkillsDir
}

/** 全局技能加载器实例 */
export const SKILLS = new SkillLoader(getSkillsDir())
