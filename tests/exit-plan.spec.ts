import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import PlanModeController, { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import * as modelRouter from '../src/index.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PLANNER = { provider: 'deepseek-official', model: 'deepseek-reasoner' }

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
  return findEvent(agent.session.events, 'request/header').data.header.config
}

describe('exit_plan_mode approval routing', () => {
  it('routes the request AFTER an approved exit to the default model, not the planner', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(PlanModeController, { section: 'Test plan mode instructions.' })
    await ctx.plugin(UserQuestionService)
    const asked: AskUserQuestionRequest[] = []
    ctx.userQuestions.registerProvider({
      ask: (request) => {
        asked.push(request)
        return Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
      },
    })
    await ctx.plugin(modelRouter, { default: DEFAULT, planner: PLANNER })
    const adapter = new MockAdapter([textResponse('still planning'), textResponse('now implementing')])
    ctx.llm.registerAdapter(['mock', 'deepseek-official'], adapter)
    const agent = ctx.agentLoop.create(SessionId('exit-plan-router'), { provider: 'mock', model: 'mock' })
    installModelSelection(agent.ctx, { current: { provider: 'mock', model: 'mock' }, assembled: undefined })

    // Baseline: a plan-mode request routes to the planner.
    ctx.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const first = lastRequestConfig(agent)
    expect(first).toEqual(PLANNER)

    // Approve the plan through the REAL exit_plan_mode tool path, which only
    // records a pending { active: false } intent (flushed at the next pre-step).
    const exit = await ctx.tools.execute({
      callId: CallId('call-exit-1'),
      name: 'exit_plan_mode',
      arguments: { plan: '# The plan\n\nimplement it' },
      signal: new AbortController().signal,
      agent,
    })
    expect(exit.isError).toBe(false)
    if (exit.isError) throw new Error('expected an approved exit')
    expect(asked).toHaveLength(1)
    // The fold stays plan until the boundary flush (silent pending exit).
    expect(foldPlanMode(agent.session.events)).toBe(true)

    // The NEXT request must route to the default model (official selection).
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'implement' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(foldPlanMode(agent.session.events)).toBe(false)
    const second = lastRequestConfig(agent)
    expect(second).toEqual(DEFAULT)

    // Surface the actual routed model names for eyeball confirmation.
    console.log(`[exit-plan-router] request 1 (in plan mode): ${first.provider}/${first.model}`)
    console.log(`[exit-plan-router] request 2 (after approval): ${second.provider}/${second.model}`)
  })
})
