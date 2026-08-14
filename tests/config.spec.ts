import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'

const ROUTE = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PLANNER = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
const SUBAGENT = { provider: 'deepseek-official', model: 'deepseek-v4-lite' }

describe('resolveConfig', () => {
  it('accepts a complete config and keeps every role', () => {
    const resolved = resolveConfig({ default: ROUTE, planner: PLANNER, subagent: SUBAGENT })
    expect(resolved.default).toEqual(ROUTE)
    expect(resolved.planner).toEqual(PLANNER)
    expect(resolved.subagent).toEqual(SUBAGENT)
  })

  it('keeps unset planner/subagent roles unset (requests pass through)', () => {
    const resolved = resolveConfig({ default: ROUTE })
    expect(resolved.planner).toBeUndefined()
    expect(resolved.subagent).toBeUndefined()
  })

  it('keeps the configured role and leaves the unset one unset', () => {
    const resolved = resolveConfig({ default: ROUTE, planner: PLANNER })
    expect(resolved.planner).toEqual(PLANNER)
    expect(resolved.subagent).toBeUndefined()
  })

  it('rejects a missing default role', () => {
    expect(() => resolveConfig({} as never)).toThrow(/default role/)
    expect(() => resolveConfig({ planner: PLANNER } as never)).toThrow(/default role/)
  })

  it('rejects blank provider or model strings', () => {
    expect(() => resolveConfig({ default: { provider: ' ', model: 'm' } })).toThrow(/non-empty provider/)
    expect(() => resolveConfig({ default: { provider: 'p', model: '' } })).toThrow(/non-empty model/)
    expect(() => resolveConfig({ default: ROUTE, planner: { provider: 'p', model: '\t' } })).toThrow(/planner role needs a non-empty model/)
  })

  it('rejects unknown config keys at load', () => {
    expect(() => resolveConfig({ default: ROUTE, plan: PLANNER } as never)).toThrow(/unknown key/)
  })
})
