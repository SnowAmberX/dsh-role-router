import { describe, expect, it } from 'vitest'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
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
  it('returns the input unchanged when the route already matches', () => {
    expect(switchRoute(BASE, BASE)).toBe(BASE)
  })

  it('replaces provider/model and keeps sampling scalars', () => {
    const resolved: LlmCallConfig = { ...BASE, temperature: 0.7, maxTokens: 2048, stop: ['END'] }
    expect(switchRoute(resolved, TARGET)).toEqual({ ...TARGET, temperature: 0.7, maxTokens: 2048, stop: ['END'] })
  })

  it('drops an inherited adapter-owned reasoning effort when switching models', () => {
    const resolved: LlmCallConfig = { ...BASE, reasoningEffort: 'max' as never }
    expect(switchRoute(resolved, TARGET)).toEqual(TARGET)
    expect(switchRoute(resolved, TARGET)).not.toHaveProperty('reasoningEffort')
  })
})
