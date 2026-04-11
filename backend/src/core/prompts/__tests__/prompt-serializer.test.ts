import assert from 'node:assert/strict'
import test from 'node:test'
import { createSlice, serializeSystemPrompt } from '../prompt-serializer.js'
import { PromptLayer } from '../prompt-layer-types.js'

function extractLayerBlock(prompt: string, tag: string): string | undefined {
  const match = prompt.match(new RegExp(`<LAYER:${tag}(?: [^>]*)?>\\n[\\s\\S]*?\\n</LAYER>`))
  return match?.[0]
}

function createBaseSlices() {
  return [
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
    createSlice(PromptLayer.StartupContext, 'Startup A'),
    createSlice(PromptLayer.SkillRuntime, ''),
    createSlice(PromptLayer.UserPreference, 'Preference A'),
  ]
}

test('serializeSystemPrompt is byte-stable across 100 runs', () => {
  const slices = createBaseSlices()
  const first = serializeSystemPrompt(slices)

  for (let index = 0; index < 100; index += 1) {
    assert.equal(serializeSystemPrompt(slices), first)
  }
})

test('startup layer changes do not affect system and mode bytes', () => {
  const basePrompt = serializeSystemPrompt(createBaseSlices())
  const changedPrompt = serializeSystemPrompt([
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
    createSlice(PromptLayer.StartupContext, 'Startup B'),
    createSlice(PromptLayer.SkillRuntime, ''),
    createSlice(PromptLayer.UserPreference, 'Preference A'),
  ])

  assert.equal(extractLayerBlock(basePrompt, 'system'), extractLayerBlock(changedPrompt, 'system'))
  assert.equal(extractLayerBlock(basePrompt, 'mode'), extractLayerBlock(changedPrompt, 'mode'))
})

test('skill layer toggling preserves system, mode and startup bytes', () => {
  const withoutSkill = serializeSystemPrompt([
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
    createSlice(PromptLayer.StartupContext, 'Startup A'),
    createSlice(PromptLayer.SkillRuntime, ''),
    createSlice(PromptLayer.UserPreference, 'Preference A'),
  ])
  const withSkill = serializeSystemPrompt([
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
    createSlice(PromptLayer.StartupContext, 'Startup A'),
    createSlice(PromptLayer.SkillRuntime, '# Skill Body', { id: 'pdf' }),
    createSlice(PromptLayer.UserPreference, 'Preference A'),
  ])

  assert.equal(extractLayerBlock(withoutSkill, 'system'), extractLayerBlock(withSkill, 'system'))
  assert.equal(extractLayerBlock(withoutSkill, 'mode'), extractLayerBlock(withSkill, 'mode'))
  assert.equal(extractLayerBlock(withoutSkill, 'startup'), extractLayerBlock(withSkill, 'startup'))
  assert.equal(extractLayerBlock(withoutSkill, 'skill'), undefined)
  assert.match(withSkill, /<LAYER:skill id="pdf">/)
})

test('serializeSystemPrompt rejects memory_recall slices', () => {
  assert.throws(
    () => serializeSystemPrompt([createSlice(PromptLayer.MemoryRecall, 'dynamic recall')]),
    /prefix cache 层/,
  )
})

test('serialized output never contains memory_recall or live_turn layer tags', () => {
  const prompt = serializeSystemPrompt(createBaseSlices())

  assert.doesNotMatch(prompt, /<LAYER:memory_recall>/)
  assert.doesNotMatch(prompt, /<LAYER:live_turn>/)
})

test('mode layer includes name attribute', () => {
  const prompt = serializeSystemPrompt([
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
  ])

  assert.match(prompt, /<LAYER:mode name="simple">/)
})

test('empty content slices are omitted from output', () => {
  const prompt = serializeSystemPrompt([
    createSlice(PromptLayer.System, 'System rule'),
    createSlice(PromptLayer.Mode, 'Mode rule', { name: 'simple' }),
    createSlice(PromptLayer.SkillRuntime, ''),
    createSlice(PromptLayer.UserPreference, '   '),
  ])

  assert.doesNotMatch(prompt, /<LAYER:skill/)
  assert.doesNotMatch(prompt, /<LAYER:user_preference>/)
})
