import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelRole } from '../src/index.ts'
import { RoleRouterCardController } from '../src/client/controller.ts'
import { RoleRouterDirectory, type RoleRouterDirectoryState } from '../src/client/model-directory.ts'

/**
 * The real client runtime ships a browser bundle (closure factory through
 * window.__ModuleLoader__) that cannot load in node; the controller and
 * directory only need the snapshot-store engine, so the tests swap in a
 * minimal implementation. The store contract under test is the controller's
 * projection/save logic, not zustand/immer.
 */
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T,>(init: T): SnapshotStore<T> => {
    let state = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      update: (mutator) => { mutator(state); for (const fn of [...listeners]) fn() },
      set: (next) => { state = next; for (const fn of [...listeners]) fn() },
    }
  },
}))

const ROUTE: ModelRole = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PLANNER: ModelRole = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
const FOLLOW_OFFICIAL = 'follow-official'

type Section = { default?: ModelRole | typeof FOLLOW_OFFICIAL; planner?: ModelRole | typeof FOLLOW_OFFICIAL; subagent?: ModelRole | typeof FOLLOW_OFFICIAL }

/** Minimal live settings scope: value store, subscribers, and a write recorder. */
class FakeScope implements SettingsScope<Section> {
  readonly calls: { field: string; value: unknown }[] = []
  fail = false
  private value: Section
  private readonly listeners = new Set<() => void>()

  constructor(initial: Section = {}) { this.value = initial }

  getSnapshot(): SettingsScopeSnapshot<Section> {
    return { status: 'ready', value: this.value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    if (this.fail) throw new Error('fake write failure')
    this.calls.push({ field, value })
    this.value = { ...this.value, [field]: value } as Section
    for (const fn of [...this.listeners]) fn()
  }

  async unset(field: string): Promise<void> {
    if (this.fail) throw new Error('fake write failure')
    this.calls.push({ field, value: undefined })
    const { [field]: _dropped, ...rest } = this.value
    this.value = rest
    for (const fn of [...this.listeners]) fn()
  }
}

/** Directory whose RPC the controller never calls in these tests. */
function idleDirectory(): RoleRouterDirectory {
  return new RoleRouterDirectory(
    { models: async () => ({ result: { ok: false, error: { code: 'unused', message: 'unused' } } }) } as never,
    () => undefined,
  )
}

/** Controller + scope pair with the card store exposed. */
function setup(initial: Section = {}) {
  const scope = new FakeScope(initial)
  const controller = new RoleRouterCardController({ role: scope }, idleDirectory())
  const face = controller.inject()
  const snapshot = () => face.hooks.roleRouterCard.getSnapshot()
  return { scope, controller, face, snapshot }
}

describe('RoleRouterCardController', () => {
  it('stages an edit, marks the field dirty, and clears on save', async () => {
    const { scope, face, snapshot } = setup()
    face.edit('default', ROUTE)
    expect(snapshot().default.dirty).toBe(true)
    expect(snapshot().dirty).toBe(true)

    await face.save()
    expect(scope.calls).toEqual([{ field: 'default', value: ROUTE }])
    expect(snapshot().default.dirty).toBe(false)
    expect(snapshot().default.staged).toBeUndefined()
    expect(snapshot().dirty).toBe(false)
    expect(snapshot().error).toBeNull()
  })

  it('keeps staged edits and reports the error when a save write fails', async () => {
    const { scope, face, snapshot } = setup()
    scope.fail = true
    face.edit('subagent', ROUTE)
    await face.save()
    // Staged edit survives the failed write; the error is surfaced.
    expect(snapshot().error).not.toBeNull()
    expect(snapshot().subagent.dirty).toBe(true)
    expect(snapshot().subagent.staged).toEqual(ROUTE)
    expect(snapshot().saving).toBe(false)
    expect(scope.calls).toEqual([])

    // A retry after the write path recovers succeeds and clears the form.
    scope.fail = false
    await face.save()
    expect(snapshot().error).toBeNull()
    expect(snapshot().subagent.dirty).toBe(false)
    expect(scope.calls).toEqual([{ field: 'subagent', value: ROUTE }])
  })

  it('clearing an already-unset role writes nothing', async () => {
    const { scope, face, snapshot } = setup()
    face.clear('planner')
    expect(snapshot().planner.dirty).toBe(false)
    await face.save()
    expect(scope.calls).toEqual([])
    expect(snapshot().planner.staged).toBeUndefined()
  })

  it('clearing a composition-backed role writes the follow-official marker', async () => {
    // A composition-configured role shows up as the settings base value.
    const { scope, face, snapshot } = setup({ planner: PLANNER })
    face.clear('planner')
    expect(snapshot().planner.dirty).toBe(true)
    await face.save()
    expect(scope.calls).toEqual([{ field: 'planner', value: FOLLOW_OFFICIAL }])
    expect(snapshot().planner.dirty).toBe(false)
  })

  it('staging the stored value is not dirty and writes nothing', async () => {
    const { scope, face, snapshot } = setup({ default: ROUTE })
    face.edit('default', ROUTE)
    expect(snapshot().default.dirty).toBe(false)
    await face.save()
    expect(scope.calls).toEqual([])
  })

  it('discard drops every staged edit and clears a previous save error', async () => {
    const { scope, face, snapshot } = setup()
    scope.fail = true
    face.edit('default', ROUTE)
    await face.save()
    expect(snapshot().error).not.toBeNull()
    face.discard()
    expect(snapshot().error).toBeNull()
    expect(snapshot().default.staged).toBeUndefined()
    expect(snapshot().dirty).toBe(false)
  })
})

describe('RoleRouterDirectory', () => {
  const okResult = (groups: unknown) => ({ result: { ok: true as const, value: { groups, failures: [] } } })

  it('marks the directory as no-session when no session id is available', async () => {
    const directory = new RoleRouterDirectory({ models: async () => okResult([]) } as never, () => undefined)
    await directory.load()
    const state: RoleRouterDirectoryState = directory.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.noSession).toBe(true)
    expect(state.groups).toEqual([])
  })

  it('loads groups through the session RPC and clears the no-session flag', async () => {
    const groups = [{ id: 'p', name: 'P', models: [] }]
    const directory = new RoleRouterDirectory(
      { models: async () => okResult(groups) } as never,
      () => 's1' as never,
    )
    await directory.load()
    const state: RoleRouterDirectoryState = directory.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.noSession).toBe(false)
    expect(state.groups).toEqual(groups)
  })

  it('surfaces a transport failure as a directory error', async () => {
    const directory = new RoleRouterDirectory(
      { models: async () => { throw new Error('wire down') } } as never,
      () => 's1' as never,
    )
    await directory.load()
    const state: RoleRouterDirectoryState = directory.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toContain('wire down')
  })

  it('lets the latest load win over a slower earlier response', async () => {
    let releaseFirst!: () => void
    const first = new Promise<never>(resolve => { releaseFirst = () => resolve(undefined as never) })
    const calls: string[] = []
    // First load stalls; the second completes first and wins.
    const directory = new RoleRouterDirectory(
      {
        models: async (request: { sessionId: string }) => {
          const marker = request.sessionId === 'first-session' ? 'first' : 'second'
          calls.push(marker)
          if (marker === 'first') await first
          return okResult([{ id: marker, name: marker, models: [] }])
        },
      } as never,
      () => 'first-session' as never,
    )
    void directory.load()
    ;(directory as { sessionId: () => string }).sessionId = () => 'second-session' as never
    await directory.load()
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 0))
    const state: RoleRouterDirectoryState = directory.store.getSnapshot()
    expect(calls).toEqual(['first', 'second'])
    expect(state.groups).toEqual([{ id: 'second', name: 'second', models: [] }])
    expect(state.status).toBe('ready')
  })

  it('stops writing after dispose', async () => {
    const directory = new RoleRouterDirectory({ models: async () => okResult([]) } as never, () => undefined)
    directory.dispose()
    await directory.load()
    expect(directory.store.getSnapshot().status).toBe('idle')
  })
})
