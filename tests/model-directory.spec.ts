/**
 * RoleRouterDirectory regression tests for the alpha.2 client architecture:
 * the settings-card catalog is the Host-generation global model catalog
 * (`ctx.remote.session.modelCatalog()`), which loads with no Session anchor.
 */

import { describe, expect, it } from 'vitest'
import type { ClientRemote, ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { RoleRouterDirectory } from '../src/client/model-directory.ts'

type SessionRemote = Pick<ClientRemote['session'], 'modelCatalog'>
type CatalogResult = Awaited<ReturnType<SessionRemote['modelCatalog']>>

const CATALOG_A: ModelCatalog = {
  default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  routableProviders: ['deepseek-official'],
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
  }],
  failures: [],
}

const CATALOG_B: ModelCatalog = {
  default: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
  routableProviders: ['deepseek-official'],
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
  }],
  failures: [{ id: 'other-provider', name: 'Other', message: 'catalog unavailable' }],
}

/** One macrotask flush: covers any microtask-only promise chain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** A session remote whose behavior is swapped per test. */
function scriptedRemote(): { remote: SessionRemote; set: (impl: () => Promise<CatalogResult>) => void } {
  let impl: () => Promise<CatalogResult> = () => Promise.resolve({ ok: true, value: CATALOG_A })
  return {
    remote: { modelCatalog: () => impl() },
    set: (next) => { impl = next },
  }
}

describe('RoleRouterDirectory (global model catalog)', () => {
  it('loads the catalog with no current Session and writes groups/failures', async () => {
    const { remote } = scriptedRemote()
    const directory = new RoleRouterDirectory(remote)
    // The directory only needs the Session-independent modelCatalog remote:
    // no session id exists anywhere in this construction or load.
    await directory.load()
    const state = directory.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.groups).toEqual(CATALOG_A.groups)
    expect(state.failures).toEqual(CATALOG_A.failures)
  })

  it('enters error on ok:false and preserves the last good groups', async () => {
    const { remote, set } = scriptedRemote()
    const directory = new RoleRouterDirectory(remote)
    await directory.load()
    expect(directory.store.getSnapshot().status).toBe('ready')

    set(() => Promise.resolve({
      ok: false,
      error: { code: 'gateway/unavailable', message: 'host is gone' },
    } as CatalogResult))
    await directory.load()
    const state = directory.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('gateway/unavailable: host is gone')
    // Last-good groups stay visible under the failure.
    expect(state.groups).toEqual(CATALOG_A.groups)
  })

  it('a stale response never overwrites a newer one', async () => {
    const { remote, set } = scriptedRemote()
    const directory = new RoleRouterDirectory(remote)
    const resolvers: ((result: CatalogResult) => void)[] = []
    set(() => new Promise<CatalogResult>((settle) => { resolvers.push(settle) }))
    const first = directory.load()
    const second = directory.load()
    // The NEWER request settles first with catalog B.
    resolvers[1]!({ ok: true, value: CATALOG_B })
    await second
    expect(directory.store.getSnapshot().groups).toEqual(CATALOG_B.groups)
    // The OLDER request settles later with catalog A: it must be dropped.
    resolvers[0]!({ ok: true, value: CATALOG_A })
    await first
    expect(directory.store.getSnapshot().groups).toEqual(CATALOG_B.groups)
  })

  it('dispose stops late settlements from writing the store', async () => {
    const { remote, set } = scriptedRemote()
    const directory = new RoleRouterDirectory(remote)
    let resolver!: (result: CatalogResult) => void
    set(() => new Promise<CatalogResult>((settle) => { resolver = settle }))
    const pending = directory.load()
    directory.dispose()
    resolver({ ok: true, value: CATALOG_A })
    await pending
    // The disposed guard dropped the write: still the loading frame.
    expect(directory.store.getSnapshot().status).toBe('loading')
  })

  it('refresh keeps last-good groups while reloading; resetGeneration clears them first', async () => {
    const { remote } = scriptedRemote()
    const directory = new RoleRouterDirectory(remote)
    await directory.load()
    expect(directory.store.getSnapshot().groups).toEqual(CATALOG_A.groups)

    // refresh(): invalidation keeps the last-good groups for a silent
    // background reload.
    directory.refresh()
    expect(directory.store.getSnapshot().status).toBe('loading')
    expect(directory.store.getSnapshot().groups).toEqual(CATALOG_A.groups)
    await flush()
    expect(directory.store.getSnapshot().status).toBe('ready')

    // resetGeneration(): a new Host generation hides the previous values.
    directory.resetGeneration()
    const cleared = directory.store.getSnapshot()
    expect(cleared.groups).toEqual([])
    expect(cleared.failures).toEqual([])
    await flush()
    expect(directory.store.getSnapshot().groups).toEqual(CATALOG_A.groups)
  })
})
