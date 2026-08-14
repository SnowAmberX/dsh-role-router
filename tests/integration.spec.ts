import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as modelRouter from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PLANNER = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
const SUBAGENT = { provider: 'deepseek-official', model: 'deepseek-v4-lite' }
const PLAN_SECTION = 'Test plan mode instructions.'

interface Harness {
  ctx: Context
  agent: Agent
  adapter: MockAdapter
}

/** Mount a real agent loop with the router (and optionally plan-mode). */
async function harness(
  config: Config,
  options: { withPlanMode?: boolean } = {},
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.withPlanMode !== false) {
    await ctx.plugin(PlanModeController, { section: PLAN_SECTION })
  }
  await ctx.plugin(modelRouter, config)
  const adapter = new MockAdapter([])
  // Serve both the harness route and the role routes under one scripted adapter.
  ctx.llm.registerAdapter(['mock', 'deepseek-official'], adapter)
  const agent = ctx.agentLoop.create(SessionId('router-main'), { provider: 'mock', model: 'mock' })
  // The official model-selection layer real deployments install per agent:
  // it is the source of the default role and covers the persisted header
  // after a planner/subagent override changed the request route.
  installModelSelection(agent.ctx, { current: { provider: 'mock', model: 'mock' }, assembled: undefined })
  return { ctx, agent, adapter }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
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

function lastRequestConfig(agent: Agent): { provider: string; model: string } {
  const header = findEvent(agent.session.events, 'request/header')
  return header.data.header.config
}

describe('model-router through the agent loop', () => {
  it('passes default-mode requests through (the official selection is the default role)', async () => {
    const { ctx, agent, adapter } = await harness({ default: DEFAULT })
    adapter.script.push(textResponse('hello'))
    // The agent's own route is the official session selection in this harness.
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('switches to the planner role when plan mode activates and back when it ends', async () => {
    const { ctx, agent, adapter } = await harness({ default: DEFAULT, planner: PLANNER })
    adapter.script.push(textResponse('first, default'), textResponse('now plan'), textResponse('now implement'))
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'one' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual({ provider: 'mock', model: 'mock' })

    ctx.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'two' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(PLANNER)

    // The exit-approval flip: plan mode ends, the next request implements
    // under the official session selection (pass-through).
    ctx.planMode.set(agent, false)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'three' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('routes by the session log fold when no plan-mode service is composed', async () => {
    const { ctx, agent, adapter } = await harness({ default: DEFAULT, planner: PLANNER }, { withPlanMode: false })
    adapter.script.push(textResponse('planning without the service'))
    // Same durable event the plan-mode plugin would append at the step boundary.
    agent.session.append('plan/mode', { active: true })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual(PLANNER)
  })

  it('passes plan-mode requests through when the planner role is unconfigured', async () => {
    const { ctx, agent, adapter } = await harness({ default: DEFAULT })
    adapter.script.push(textResponse('planning with fallback'))
    ctx.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(lastRequestConfig(agent)).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('routes subagent requests to the subagent role in every mode', async () => {
    const { ctx, adapter } = await harness({ default: DEFAULT, subagent: SUBAGENT })
    const signal = new AbortController().signal
    const child = await ctx.agents.create({
      sessionId: SessionId('router-child'),
      meta: { origin: 'subagent', delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
      signal,
    })
    adapter.script.push(textResponse('default mode child'), textResponse('plan mode child'))
    child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task one' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, child.agent)
    expect(lastRequestConfig(child.agent)).toEqual(SUBAGENT)

    // The parent enters plan mode; the child still uses the subagent role.
    const parent = ctx.agentLoop.create(SessionId('router-parent'), { provider: 'mock', model: 'mock' })
    ctx.planMode.set(parent, true)
    child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task two' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, child.agent)
    expect(lastRequestConfig(child.agent)).toEqual(SUBAGENT)
    await child.dispose()
  })

  it('keeps the persona variables in step with the routed role', async () => {
    const { ctx, agent, adapter } = await harness({ default: DEFAULT, planner: PLANNER })
    ctx.systemPrompt.section({
      name: 'test:persona',
      order: 0,
      text: () => 'You are powered by {{model}} via {{provider}}.',
    })
    adapter.script.push(textResponse('persona in plan mode'))
    ctx.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const header = findEvent(agent.session.events, 'request/header')
    expect(header.data.header.system).toContain(`You are powered by ${PLANNER.model} via ${PLANNER.provider}.`)
  })
})
