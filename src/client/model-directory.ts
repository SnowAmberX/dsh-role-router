/**
 * Runtime model directory for the settings card: the provider-grouped catalog
 * the host assembles for Host-generation selectors (`ctx.remote.session
 * .modelCatalog()` — the same advisory catalog the official /model picker
 * serves, with no Session anchor). Shared by the card fields through one
 * snapshot store; refreshes ride the forwarded `llm/adapters-updated`,
 * `settings/document-updated`, and `credentials/reference-updated` events,
 * and `connection/reset` starts a new Host generation.
 */

import type {
  ClientRemote, ModelCatalogFailure, ModelProviderGroup,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

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
}

/** Fresh directory state. */
function initialDirectory(): RoleRouterDirectoryState {
  return { groups: [], failures: [], status: 'idle', error: null }
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
 * The settings card's directory controller: loads the Host-generation model
 * catalog through the session remote's `modelCatalog()` RPC — a global
 * catalog that needs no current Session — and keeps one snapshot store for
 * all three fields.
 */
export class RoleRouterDirectory {
  /** The shared snapshot store (uSES-safe). */
  readonly store: SnapshotStore<RoleRouterDirectoryState> = createSnapshotStore(initialDirectory())

  /** Latest operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false

  constructor(
    private readonly session: Pick<ClientRemote['session'], 'modelCatalog'>,
  ) {}

  /** Refresh the advisory directory; failure preserves the last good groups. */
  async load(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let response
    try {
      response = await this.session.modelCatalog()
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = String(error)
      })
      return
    }
    if (this.disposed || generation !== this.generation) return
    if (!response.ok) {
      this.store.update((s) => {
        s.status = 'error'
        s.error = `${response.error.code}: ${response.error.message}`
      })
      return
    }
    this.store.update((s) => {
      s.groups = response.value.groups
      s.failures = response.value.failures
      s.status = 'ready'
      s.error = null
    })
  }

  /**
   * Invalidate the loaded catalog; the next read reloads it.
   * @param clear - whether values from the previous Host generation must be hidden.
   */
  private invalidate(clear: boolean): void {
    this.generation += 1
    if (clear) {
      this.store.set(initialDirectory())
    } else {
      this.store.update((s) => { s.status = 'idle'; s.error = null })
    }
  }

  /** Invalidate and reload the catalog after a Host-side model input changes. */
  refresh(): void {
    this.invalidate(false)
    void this.load().catch(() => { /* the card exposes the shared error */ })
  }

  /** Clear Host-specific values and load the replacement Host generation. */
  resetGeneration(): void {
    this.invalidate(true)
    void this.load().catch(() => { /* the card exposes the shared error */ })
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
  }
}
