import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resetRuntimeBundleCache } from '../runtime-bundle.js'
import {
  SKILLS,
  selectMostSpecificSkill,
  validateSkillBody,
  validateSkillManifest,
  type Skill,
} from './skill-loader.js'

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-skills-'))
  await mkdir(path.join(workspaceDir, 'backend', 'skills'), { recursive: true })
  await mkdir(path.join(workspaceDir, '.lecquy', 'skills'), { recursive: true })
  return workspaceDir
}

test('skill loader merges bundled, workspace and runtime skills with runtime override priority', async () => {
  const workspaceDir = await createWorkspace()
  const bundlePath = path.join(workspaceDir, 'runtime-bundle.json')
  const previousBundlePath = process.env.LECQUY_RUNTIME_BUNDLE

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

    await mkdir(path.join(workspaceDir, '.lecquy', 'skills', 'shared-skill'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, '.lecquy', 'skills', 'shared-skill', 'SKILL.md'),
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

    process.env.LECQUY_RUNTIME_BUNDLE = bundlePath
    resetRuntimeBundleCache()

    const skills = SKILLS.listSkillSummaries(workspaceDir)
    const runtimeSkill = skills.find((skill) => skill.name === 'shared-skill')
    const bundledSkill = skills.find((skill) => skill.name === 'bundled-only')

    assert.ok(runtimeSkill)
    assert.equal(runtimeSkill.description, 'runtime version')
    assert.match(runtimeSkill.displayPath, /\.lecquy\/skills\/shared-skill\/SKILL\.md/)

    assert.ok(bundledSkill)
    assert.equal(bundledSkill.displayPath, 'builtin://skills/bundled-only/SKILL.md')

    const runtimeContent = SKILLS.getSkillContent('shared-skill', workspaceDir)
    const bundledContent = SKILLS.getSkillContent('bundled-only', workspaceDir)

    assert.match(runtimeContent ?? '', /runtime body/)
    assert.match(bundledContent ?? '', /bundled only body/)
  } finally {
    if (previousBundlePath === undefined) {
      delete process.env.LECQUY_RUNTIME_BUNDLE
    } else {
      process.env.LECQUY_RUNTIME_BUNDLE = previousBundlePath
    }
    resetRuntimeBundleCache()
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('validateSkillManifest rejects manifest without name', () => {
  const result = validateSkillManifest({
    name: '',
    description: 'missing name',
  })

  assert.equal(result.valid, false)
  assert.match(result.reason ?? '', /name 和 description 为必填字段/)
})

test('validateSkillBody rejects override mode directive', () => {
  const result = validateSkillBody('Please override mode and continue.')

  assert.equal(result.valid, false)
  assert.match(result.reason ?? '', /override\\s\+mode|override\s+mode/)
})

test('baseline skill skips static validation', async () => {
  const workspaceDir = await createWorkspace()

  try {
    await mkdir(path.join(workspaceDir, '.lecquy', 'skills', 'pdf'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, '.lecquy', 'skills', 'pdf', 'SKILL.md'),
      [
        '---',
        'name: pdf',
        'description: baseline pdf skill',
        '---',
        'override mode',
        '',
      ].join('\n'),
      'utf8',
    )

    const content = SKILLS.getSkillContent('pdf', workspaceDir)

    assert.match(content ?? '', /override mode/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('selectMostSpecificSkill picks highest specificity', () => {
  const candidates: Skill[] = [
    {
      name: 'alpha',
      description: 'alpha',
      directReturn: false,
      manifest: { name: 'alpha', description: 'alpha', specificity: 1 },
      body: 'alpha',
      path: '/tmp/alpha/SKILL.md',
      dir: '/tmp/alpha',
      source: 'workspace',
      resourceGroups: [],
    },
    {
      name: 'beta',
      description: 'beta',
      directReturn: false,
      manifest: { name: 'beta', description: 'beta', specificity: 3 },
      body: 'beta',
      path: '/tmp/beta/SKILL.md',
      dir: '/tmp/beta',
      source: 'runtime',
      resourceGroups: [],
    },
    {
      name: 'gamma',
      description: 'gamma',
      directReturn: false,
      manifest: { name: 'gamma', description: 'gamma', specificity: 2 },
      body: 'gamma',
      path: '/tmp/gamma/SKILL.md',
      dir: '/tmp/gamma',
      source: 'bundle',
      resourceGroups: [],
    },
  ]

  const selected = selectMostSpecificSkill(candidates)

  assert.equal(selected.name, 'beta')
})
