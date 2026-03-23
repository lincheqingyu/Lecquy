import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resetRuntimeBundleCache } from '../runtime-bundle.js'
import { SKILLS } from './skill-loader.js'

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zxhclaw-skills-'))
  await mkdir(path.join(workspaceDir, 'backend', 'skills'), { recursive: true })
  await mkdir(path.join(workspaceDir, '.ZxhClaw', 'skills'), { recursive: true })
  return workspaceDir
}

test('skill loader merges bundled, workspace and runtime skills with runtime override priority', async () => {
  const workspaceDir = await createWorkspace()
  const bundlePath = path.join(workspaceDir, 'runtime-bundle.json')
  const previousBundlePath = process.env.WEBCLAW_RUNTIME_BUNDLE

  try {
    await mkdir(path.join(workspaceDir, 'backend', 'skills', 'shared-skill'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, 'backend', 'skills', 'shared-skill', 'SKILL.md'),
      [
        '---',
        'name: shared-skill',
        'description: workspace version',
        '---',
        'workspace body',
        '',
      ].join('\n'),
      'utf8',
    )

    await mkdir(path.join(workspaceDir, '.ZxhClaw', 'skills', 'shared-skill'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, '.ZxhClaw', 'skills', 'shared-skill', 'SKILL.md'),
      [
        '---',
        'name: shared-skill',
        'description: runtime version',
        '---',
        'runtime body',
        '',
      ].join('\n'),
      'utf8',
    )

    await writeFile(
      bundlePath,
      JSON.stringify(
        {
          version: 1,
          generatedAt: new Date().toISOString(),
          frontend: {},
          skills: {
            'shared-skill/SKILL.md': [
              '---',
              'name: shared-skill',
              'description: bundled version',
              '---',
              'bundled body',
              '',
            ].join('\n'),
            'bundled-only/SKILL.md': [
              '---',
              'name: bundled-only',
              'description: bundled only version',
              '---',
              'bundled only body',
              '',
            ].join('\n'),
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.WEBCLAW_RUNTIME_BUNDLE = bundlePath
    resetRuntimeBundleCache()

    const skills = SKILLS.listSkillSummaries(workspaceDir)
    const runtimeSkill = skills.find((skill) => skill.name === 'shared-skill')
    const bundledSkill = skills.find((skill) => skill.name === 'bundled-only')

    assert.ok(runtimeSkill)
    assert.equal(runtimeSkill.description, 'runtime version')
    assert.match(runtimeSkill.displayPath, /\.ZxhClaw\/skills\/shared-skill\/SKILL\.md/)

    assert.ok(bundledSkill)
    assert.equal(bundledSkill.displayPath, 'builtin://skills/bundled-only/SKILL.md')

    const runtimeContent = SKILLS.getSkillContent('shared-skill', workspaceDir)
    const bundledContent = SKILLS.getSkillContent('bundled-only', workspaceDir)

    assert.match(runtimeContent ?? '', /runtime body/)
    assert.match(bundledContent ?? '', /bundled only body/)
  } finally {
    if (previousBundlePath === undefined) {
      delete process.env.WEBCLAW_RUNTIME_BUNDLE
    } else {
      process.env.WEBCLAW_RUNTIME_BUNDLE = previousBundlePath
    }
    resetRuntimeBundleCache()
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
