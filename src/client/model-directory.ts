/**
 * Runtime model directory for the settings card: the provider-grouped catalog
 * the host assembles from `ctx.llm.listProviders()` × `listModels()` — the
 * same advisory catalog the official /model picker serves. Shared by the card
 * fields through one snapshot store; refreshes ride `llm/adapters-updated`
 * and `settings/document-updated` forwarded events.
 */

import type {
  IApiClient, ModelCatalogFailure, ModelProviderGroup, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Directory snapshot the card fields render from. */
export interface RoleRouterDirectoryState {
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-request failure text; null when none. */
  error: string | null
  /** Whether no session is open yet (the directory anchors on a session RPC). */
  noSession: boolean
}

/** Fresh directory state. */
function initialDirectory(): RoleRouterDirectoryState {
  return { groups: [], failures: [], status: 'idle', error: null, noSession: false }
}

/** Resolve a model's display name from the loaded groups, falling back to its id. */
export function displayModelName(
  state: Pick<RoleRouterDirectoryState, 'groups'>,
  provider: string,
  model: string,
): string {
  const group = state.groups.find(candidate => candidate.id === provider)
  const entry = group?.models.find(candidate => candidate.id === model)
  return entry?.name ?? model
}

/**
 * The settings card's directory controller: loads the host catalog through the
 * current session's models RPC (the groups are global; the session only
 * anchors the RPC) and keeps one snapshot store for all three fields.
 */
export class RoleRouterDirectory {
  /** The shared snapshot store (uSES-safe). */
  readonly store: SnapshotStore<RoleRouterDirectoryState> = createSnapshotStore(initialDirectory())

  /** Latest operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false

  constructor(
    private readonly sessions: Pick<IApiClient['sessions'], 'models'>,
    private readonly sessionId: () => SessionId | undefined,
  ) {}

  /** Refresh the advisory directory; failure preserves the last good groups. */
  async load(): Promise<void> {
    if (this.disposed) return
    const sessionId = this.sessionId()
    if (sessionId === undefined) {
      this.store.update((s) => { s.status = 'ready'; s.error = null; s.noSession = true })
      return
    }
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null; s.noSession = false })
    let result
    try {
      result = (await this.sessions.models({ sessionId })).result
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = String(error)
      })
      return
    }
    if (this.disposed || generation !== this.generation) return
    if (!result.ok) {
      this.store.update((s) => {
        s.status = 'error'
        s.error = `${result.error.code}: ${result.error.message}`
      })
      return
    }
    this.store.update((s) => {
      s.groups = result.value.groups
      s.failures = result.value.failures
      s.status = 'ready'
      s.error = null
      s.noSession = false
    })
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
  }
}
