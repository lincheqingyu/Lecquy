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
