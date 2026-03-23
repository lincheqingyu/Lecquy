/**
 * 技能加载器
 * 技能来源按优先级合并：
 * 1. 程序内置 bundle
 * 2. 仓库内 backend/skills（开发期覆盖）
 * 3. .ZxhClaw/skills（部署后扩展/覆盖）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path, { join, resolve } from 'node:path'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { listBundledSkillFiles } from '../runtime-bundle.js'
import { resolveRuntimePaths } from '../runtime-paths.js'

type SkillSourceKind = 'bundle' | 'workspace' | 'runtime'

interface SkillResourceGroup {
  readonly folder: 'scripts' | 'references' | 'assets'
  readonly label: string
  readonly files: readonly string[]
}

/** 解析后的技能数据 */
export interface Skill {
  readonly name: string
  readonly description: string
  readonly directReturn: boolean
  readonly body: string
  readonly path: string
  readonly dir: string
  readonly source: SkillSourceKind
  readonly resourceGroups: readonly SkillResourceGroup[]
}

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly source: SkillSourceKind
  readonly displayPath: string
}

interface ParsedSkillMetadata {
  readonly name: string
  readonly description: string
  readonly directReturn: boolean
  readonly body: string
}

const RESOURCE_FOLDERS = [
  ['scripts', '脚本'],
  ['references', '参考资料'],
  ['assets', '资源文件'],
] as const

class SkillLoader {
  private collectResourceGroupsFromDir(skillDir: string): SkillResourceGroup[] {
    const groups: SkillResourceGroup[] = []

    for (const [folder, label] of RESOURCE_FOLDERS) {
      const folderPath = join(skillDir, folder)
      if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) continue

      const files = readdirSync(folderPath)
        .filter((entry) => {
          const fullPath = join(folderPath, entry)
          return existsSync(fullPath) && statSync(fullPath).isFile()
        })
        .sort()

      if (files.length > 0) {
        groups.push({ folder, label, files })
      }
    }

    return groups
  }

  private collectResourceGroupsFromBundle(skillDirName: string): SkillResourceGroup[] {
    const bundleFiles = listBundledSkillFiles()
    const prefix = `${skillDirName}/`
    const groups = new Map<string, string[]>()

    for (const relativePath of Object.keys(bundleFiles)) {
      if (!relativePath.startsWith(prefix) || relativePath === `${skillDirName}/SKILL.md`) continue

      const nested = relativePath.slice(prefix.length)
      const [folder, ...rest] = nested.split('/')
      if (rest.length === 0 || !RESOURCE_FOLDERS.some(([name]) => name === folder)) continue

      const fileName = rest.join('/')
      const current = groups.get(folder) ?? []
      current.push(fileName)
      groups.set(folder, current)
    }

    const resourceGroups: SkillResourceGroup[] = []
    for (const [folder, label] of RESOURCE_FOLDERS) {
      const files = (groups.get(folder) ?? []).sort()
      if (files.length === 0) continue
      resourceGroups.push({ folder, label, files })
    }

    return resourceGroups
  }

  private parseSkillMd(content: string): ParsedSkillMetadata | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
    if (!match) return null

    const [, frontmatter, body] = match
    const metadata: Record<string, string> = {}
    for (const line of frontmatter.trim().split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      metadata[key] = value
    }

    if (!metadata['name'] || !metadata['description']) return null

    const directReturnRaw = metadata['direct_return'] ?? 'false'
    return {
      name: metadata['name'],
      description: metadata['description'],
      directReturn: ['true', '1', 'yes'].includes(directReturnRaw.toLowerCase()),
      body: body.trim(),
    }
  }

  private scanBundledSkills(skills: Map<string, Skill>): void {
    const bundleFiles = listBundledSkillFiles()
    const skillDirs = new Set<string>()

    for (const relativePath of Object.keys(bundleFiles)) {
      if (relativePath.endsWith('/SKILL.md')) {
        skillDirs.add(relativePath.slice(0, -'/SKILL.md'.length))
      }
    }

    for (const skillDirName of Array.from(skillDirs).sort()) {
      const raw = bundleFiles[`${skillDirName}/SKILL.md`]
      if (!raw) continue

      const parsed = this.parseSkillMd(raw)
      if (!parsed) continue

      const virtualPath = `builtin://skills/${skillDirName}/SKILL.md`
      skills.set(parsed.name, {
        ...parsed,
        path: virtualPath,
        dir: `builtin://skills/${skillDirName}`,
        source: 'bundle',
        resourceGroups: this.collectResourceGroupsFromBundle(skillDirName),
      })
    }
  }

  private scanSkillsDir(skillsDir: string, source: SkillSourceKind, skills: Map<string, Skill>): void {
    if (!existsSync(skillsDir)) return

    for (const entry of readdirSync(skillsDir)) {
      const dirPath = join(skillsDir, entry)
      if (!statSync(dirPath).isDirectory()) continue

      const skillMd = join(dirPath, 'SKILL.md')
      if (!existsSync(skillMd)) continue

      const parsed = this.parseSkillMd(readFileSync(skillMd, 'utf8'))
      if (!parsed) continue

      skills.set(parsed.name, {
        ...parsed,
        path: skillMd,
        dir: resolve(skillMd, '..'),
        source,
        resourceGroups: this.collectResourceGroupsFromDir(dirPath),
      })
    }
  }

  private scanSkills(workspaceDir?: string): Map<string, Skill> {
    const runtimePaths = resolveRuntimePaths(workspaceDir)
    const skills = new Map<string, Skill>()

    this.scanBundledSkills(skills)
    this.scanSkillsDir(runtimePaths.backendSkillsDir, 'workspace', skills)
    this.scanSkillsDir(runtimePaths.runtimeSkillsDir, 'runtime', skills)

    return skills
  }

  private formatDisplayPath(skill: Skill, workspaceDir?: string): string {
    if (skill.source === 'bundle') {
      return skill.path
    }

    const rootDir = path.resolve(resolveRuntimePaths(workspaceDir).workspaceDir)
    const relative = path.relative(rootDir, skill.path)
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : skill.path
  }

  /** 生成系统提示的技能描述 */
  getDescriptions(workspaceDir?: string): string {
    const skills = this.scanSkills(workspaceDir)
    if (skills.size === 0) return '(没有可用的技能)'

    return Array.from(skills.entries())
      .map(([name, skill]) => `- ${name}: ${skill.description}`)
      .join('\n')
  }

  /** 获取完整技能内容 */
  getSkillContent(name: string, workspaceDir?: string): string | null {
    const skill = this.scanSkills(workspaceDir).get(name)
    if (!skill) return null

    let content = `# Skill: ${skill.name}\n\n${skill.body}`
    if (skill.resourceGroups.length > 0) {
      const locationLabel = skill.source === 'bundle' ? '内置技能资源' : `${skill.dir} 中的可用资源`
      content += `\n\n**${locationLabel}：**\n`
      content += skill.resourceGroups.map((group) => `- ${group.label}: ${group.files.join(', ')}`).join('\n')
    }

    return content
  }

  /** 获取技能工具列表（当前不支持动态工具加载，返回空数组） */
  getSkillTools(_name: string): AgentTool[] {
    return []
  }

  /** 判断指定 skill 是否标记了 direct_return */
  isDirectReturn(skillName: string, workspaceDir?: string): boolean {
    return this.scanSkills(workspaceDir).get(skillName)?.directReturn ?? false
  }

  /** 通过工具名反查所属 skill 名称（当前无动态工具，始终返回 null） */
  getSkillNameByTool(_toolName: string): string | null {
    return null
  }

  /** 返回可用技能名称列表 */
  listSkills(workspaceDir?: string): string[] {
    return Array.from(this.scanSkills(workspaceDir).keys())
  }

  /** 返回技能摘要列表，供系统提示词生成器使用 */
  listSkillSummaries(workspaceDir?: string): SkillSummary[] {
    return Array.from(this.scanSkills(workspaceDir).values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      source: skill.source,
      displayPath: this.formatDisplayPath(skill, workspaceDir),
    }))
  }
}

/** 全局技能加载器实例 */
export const SKILLS = new SkillLoader()
