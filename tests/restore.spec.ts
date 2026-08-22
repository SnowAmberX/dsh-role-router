import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import * as modelRouter from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const A = { provider: 'mock', model: 'mock-a' }
const P = { provider: 'mock', model: 'mock-planner' }
const D = { provider: 'mock', model: 'mock-default' }
const PLAN_SECTION = 'Test plan mode instructions.'

/**
 * Edge-restore harness. Deliberately does NOT install the per-agent
 * installModelSelection: the agent loop's seed is requestProposal(last
 * request/header), which reproduces the official tier-2 behavior ("latest
 * logged request wins") that a forced planner route pollutes — exactly the
 * condition the restore state machine compensates for.
 */
async function harness(config: Config) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PlanModeController, { section: PLAN_SECTION })
  await ctx.plugin(modelRouter, config)
  const adapter = new MockAdapter([])
  ctx.llm.registerAdapter(['mock', 'deepseek-official'], adapter)
  return { ctx, adapter }
}

function waitForIdle(ctx: Context, agent: Parameters<typeof ctx.agentLoop.create>[0] extends never ? never : unknown): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function findEvent<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
): Extract<SessionEvent, { type: T }> {
  const found = log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

function lastRequestConfig(agent: { session: { events: readonly SessionEvent[] } }): { provider: string; model: string } {
  const header = findEvent(agent.session.events, 'request/header')
  return header.data.header.config
}

function lastSystem(agent: { session: { events: readonly SessionEvent[] } }): string {
  const header = findEvent(agent.session.events, 'request/header')
  return header.data.header.system
}

function say(agent: { followup: (message: unknown) => unknown }, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('plan-exit route restore', () => {
  it('A: restores the pre-plan official selection once when leaving plan mode', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    const agent = ctx.agentLoop.create(SessionId('restore-a'), A)
    adapter.script.push(textResponse('n1'), textResponse('n2'), textResponse('n3'), textResponse('n4'), textResponse('n5'))

    say(agent, 'one')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)

    ctx.planMode.set(agent, true)
    say(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)

    say(agent, 'three')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)

    // Exit edge: the seed is the polluted header (P); the plugin restores A once.
    ctx.planMode.set(agent, false)
    say(agent, 'four')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)

    // Ordinary pass-through resumes.
    say(agent, 'five')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
  })

  it('B: keeps the snapshot untouched across several plan rounds', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    const agent = ctx.agentLoop.create(SessionId('restore-b'), A)
    adapter.script.push(
      textResponse('n'), textResponse('p1'), textResponse('p2'), textResponse('p3'),
      textResponse('exit'), textResponse('after'),
    )

    say(agent, 'normal')
    await waitForIdle(ctx, agent)
    ctx.planMode.set(agent, true)
    say(agent, 'plan1')
    await waitForIdle(ctx, agent)
    say(agent, 'plan2')
    await waitForIdle(ctx, agent)
    say(agent, 'plan3')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)

    // The restore target must still be the pre-plan A, not any planner round.
    ctx.planMode.set(agent, false)
    say(agent, 'exit')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)

    say(agent, 'after')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
  })

  it('C: a fixed default role wins over the restore on exit', async () => {
    const { ctx, adapter } = await harness({ default: D, planner: P })
    const agent = ctx.agentLoop.create(SessionId('restore-c'), A)
    adapter.script.push(textResponse('n1'), textResponse('p'), textResponse('exit'), textResponse('n2'))

    say(agent, 'normal')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(D)

    ctx.planMode.set(agent, true)
    say(agent, 'plan')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)

    ctx.planMode.set(agent, false)
    say(agent, 'exit')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(D)

    say(agent, 'normal2')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(D)
  })

  it('D: never entering plan keeps pure pass-through', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    const agent = ctx.agentLoop.create(SessionId('restore-d'), A)
    adapter.script.push(textResponse('n1'), textResponse('n2'))

    say(agent, 'one')
    await waitForIdle(ctx, agent)
    say(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
  })

  it('E: one session plan edge does not leak into another session', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    const a1 = ctx.agentLoop.create(SessionId('restore-e1'), A)
    const a2 = ctx.agentLoop.create(SessionId('restore-e2'), A)
    adapter.script.push(
      textResponse('a1-normal'), textResponse('a1-plan'), textResponse('a2-normal'),
      textResponse('a1-exit'), textResponse('a2-normal2'),
    )

    say(a1, 'normal')
    await waitForIdle(ctx, a1)
    expect(lastRequestConfig(a1)).toEqual(A)

    ctx.planMode.set(a1, true)
    say(a1, 'plan')
    await waitForIdle(ctx, a1)
    expect(lastRequestConfig(a1)).toEqual(P)

    // The untouched session keeps its own pass-through route.
    say(a2, 'normal')
    await waitForIdle(ctx, a2)
    expect(lastRequestConfig(a2)).toEqual(A)

    ctx.planMode.set(a1, false)
    say(a1, 'exit')
    await waitForIdle(ctx, a1)
    expect(lastRequestConfig(a1)).toEqual(A)

    say(a2, 'normal2')
    await waitForIdle(ctx, a2)
    expect(lastRequestConfig(a2)).toEqual(A)
  })

  it('F: an unconfigured planner never snapshots or restores', async () => {
    const { ctx, adapter } = await harness({})
    const agent = ctx.agentLoop.create(SessionId('restore-f'), A)
    adapter.script.push(textResponse('n'), textResponse('plan'), textResponse('exit'))

    say(agent, 'normal')
    await waitForIdle(ctx, agent)
    ctx.planMode.set(agent, true)
    say(agent, 'plan')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)

    ctx.planMode.set(agent, false)
    say(agent, 'exit')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
  })

  it('G: re-entering plan snapshots the official route again', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    const agent = ctx.agentLoop.create(SessionId('restore-g'), A)
    adapter.script.push(
      textResponse('n'), textResponse('p1'), textResponse('exit1'), textResponse('n2'),
      textResponse('p2'), textResponse('exit2'),
    )

    say(agent, 'normal')
    await waitForIdle(ctx, agent)
    ctx.planMode.set(agent, true)
    say(agent, 'plan1')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)
    ctx.planMode.set(agent, false)
    say(agent, 'exit1')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)

    say(agent, 'normal2')
    await waitForIdle(ctx, agent)
    ctx.planMode.set(agent, true)
    say(agent, 'plan2')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(P)
    ctx.planMode.set(agent, false)
    say(agent, 'exit2')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
  })

  it('H: the exit-edge persona variables restore together with the request', async () => {
    const { ctx, adapter } = await harness({ planner: P })
    ctx.systemPrompt.section({
      name: 'test:persona',
      order: 0,
      text: () => 'You are powered by {{model}} via {{provider}}.',
    })
    const agent = ctx.agentLoop.create(SessionId('restore-h'), A)
    adapter.script.push(textResponse('n'), textResponse('p'), textResponse('exit'))

    say(agent, 'normal')
    await waitForIdle(ctx, agent)
    expect(lastSystem(agent)).toContain('powered by mock-a via mock')

    ctx.planMode.set(agent, true)
    say(agent, 'plan')
    await waitForIdle(ctx, agent)
    expect(lastSystem(agent)).toContain('powered by mock-planner via mock')

    // The first post-plan turn must assemble the restored model, not the planner.
    ctx.planMode.set(agent, false)
    say(agent, 'exit')
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(A)
    expect(lastSystem(agent)).toContain('powered by mock-a via mock')
    expect(lastSystem(agent)).not.toContain('mock-planner')
  })
})
