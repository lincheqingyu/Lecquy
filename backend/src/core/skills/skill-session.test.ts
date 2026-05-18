// 中文：本文件（skill-session.test.ts）位于 backend/src/core/skills/skill-session.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (skill-session.test.ts) belongs to the backend 测试用例 layer in backend/src/core/skills/skill-session.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'
import { SkillSession } from './skill-session.js'

test('SkillSession hasActiveSkill becomes true after loadAndFreeze', () => {
  const session = new SkillSession()

  session.loadAndFreeze('pdf', '# PDF Skill Body')

  assert.equal(session.hasActiveSkill(), true)
})

test('SkillSession getSlice returns frozen content', () => {
  const session = new SkillSession()
  session.loadAndFreeze('pdf', '# PDF Skill Body')

  const slice = session.getSlice()

  assert.equal(slice.content, '# PDF Skill Body')
  assert.equal(slice.attributes?.id, 'pdf')
})

test('SkillSession hasActiveSkill becomes false after unload', () => {
  const session = new SkillSession()
  session.loadAndFreeze('pdf', '# PDF Skill Body')

  session.unload()

  assert.equal(session.hasActiveSkill(), false)
})

test('SkillSession getSlice returns empty content after unload', () => {
  const session = new SkillSession()
  session.loadAndFreeze('pdf', '# PDF Skill Body')
  session.unload()

  const slice = session.getSlice()

  assert.equal(slice.content, '')
})
