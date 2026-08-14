import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { classify, switchRoute } from '../src/index.ts'

const BASE: LlmCallConfig = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const TARGET = { provider: 'deepseek-official', model: 'deepseek-reasoner' }

describe('classify', () => {
  it('routes subagent requests to the subagent role in every mode', () => {
    expect(classify('subagent', true)).toBe('subagent')
    expect(classify('subagent', false)).toBe('subagent')
  })

  it('routes top-level plan-mode requests to the planner role', () => {
    expect(classify(undefined, true)).toBe('planner')
    expect(classify('user', true)).toBe('planner')
  })

  it('routes top-level default-mode requests to the default role', () => {
    expect(classify(undefined, false)).toBe('default')
    expect(classify('user', false)).toBe('default')
  })
})

describe('switchRoute', () => {
  it('returns the input unchanged when the route already matches and no effort is set', () => {
    expect(switchRoute(BASE, BASE)).toBe(BASE)
  })

  it('replaces provider/model and keeps sampling scalars', () => {
    const resolved: LlmCallConfig = { ...BASE, temperature: 0.7, maxTokens: 2048, stop: ['END'] }
    expect(switchRoute(resolved, TARGET)).toEqual({ ...TARGET, temperature: 0.7, maxTokens: 2048, stop: ['END'] })
  })

  it('drops an inherited adapter-owned reasoning effort when switching without a configured effort', () => {
    const resolved: LlmCallConfig = { ...BASE, reasoningEffort: ReasoningEffortId('max') }
    expect(switchRoute(resolved, TARGET)).toEqual(TARGET)
    expect(switchRoute(resolved, TARGET)).not.toHaveProperty('reasoningEffort')
  })

  it('applies a configured effort when switching models', () => {
    const resolved: LlmCallConfig = { ...BASE, temperature: 0.5 }
    const target = { ...TARGET, reasoningEffort: 'high' }
    expect(switchRoute(resolved, target)).toEqual({
      provider: TARGET.provider,
      model: TARGET.model,
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.5,
    })
  })

  it('replaces an inherited effort with the configured one when switching', () => {
    const resolved: LlmCallConfig = { ...BASE, reasoningEffort: ReasoningEffortId('max') }
    const target = { ...TARGET, reasoningEffort: 'high' }
    expect(switchRoute(resolved, target)).toEqual({
      provider: TARGET.provider,
      model: TARGET.model,
      reasoningEffort: ReasoningEffortId('high'),
    })
  })

  it('sets an effort on the same route without dropping other scalars', () => {
    const resolved: LlmCallConfig = { ...BASE, temperature: 0.3 }
    const target = { ...BASE, reasoningEffort: 'high' }
    expect(switchRoute(resolved, target)).toEqual({
      provider: BASE.provider,
      model: BASE.model,
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.3,
    })
  })
})
