/**
 * Settings-card controller: a staged form over the `role-router` settings
 * namespace (default / planner / subagent fields). The host half mirrors the
 * `default` field into the official `agent-default-model` section (preserving
 * its effort unless the route sets one explicitly). Writes are field-level
 * (`SettingsScope.set`) and role objects are replaced as whole fields.
 */

import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelRole } from '../index.ts'
import type { RoleRouterDirectory, RoleRouterDirectoryState } from './model-directory.ts'

/** Sentinel marking a staged edit as "unset this role" (follow the official selector). */
export const UNSET_ROLE = 'unset' as const

/** One staged edit: a concrete route, the unset sentinel, or none. */
export type StagedEdit = ModelRole | typeof UNSET_ROLE | undefined

/** One card field: the stored value, the staged edit, and write state. */
export interface RoleFieldState {
  /** Stored value (settings or composition layer). */
  stored: ModelRole | undefined
  /** Staged edit; undefined means the stored value. */
  staged: StagedEdit
  /** Whether a save would write this field. */
  dirty: boolean
}

/** The card's rendered state. */
export interface RoleRouterCardState {
  /** False while either namespace is still loading. */
  available: boolean
  /** Whether both namespaces are served to this client. */
  exposed: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether any field holds an unsaved edit. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Last save failure text; null when the last save succeeded. */
  error: string | null
  /** The three role fields. */
  default: RoleFieldState
  planner: RoleFieldState
  subagent: RoleFieldState
  /** The shared model catalog. */
  directory: RoleRouterDirectoryState
}

/** The registration-side face the card's slot entry injects. */
export interface RoleRouterCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useRoleRouterCard. */
    roleRouterCard: SnapshotStore<RoleRouterCardState>
  }
  /** Refresh the shared model catalog. */
  loadDirectory(): void
  /** Stage one role's model selection. */
  edit(role: 'default' | 'planner' | 'subagent', value: ModelRole): void
  /** Stage "unset this role" (saved as a clear; the role follows the official selector). */
  clear(role: 'default' | 'planner' | 'subagent'): void
  /** Discard a role's staged edit (back to the stored value). */
  reset(role: 'default' | 'planner' | 'subagent'): void
  /** Write every dirty field to its namespace. */
  save(): Promise<void>
  /** Drop every staged edit. */
  discard(): void
}

/** The card's per-field write face per namespace. */
interface ScopePair {
  role: SettingsScope<RoleRouterSettingsSection>
}

/** The settings sentinel written when a role is explicitly unset (mirrors the host half). */
const FOLLOW_OFFICIAL = 'follow-official'

/** One writeable section value: a concrete route or the follow-official marker. */
type RoleSettingsSectionValue = ModelRole | typeof FOLLOW_OFFICIAL

/** The role-router settings section shape (mirrors the host half). */
interface RoleRouterSettingsSection {
  default?: ModelRole | typeof FOLLOW_OFFICIAL
  planner?: ModelRole | typeof FOLLOW_OFFICIAL
  subagent?: ModelRole | typeof FOLLOW_OFFICIAL
}

/** Deep-compare two role routes (reference-equal when both undefined). */
function sameRoute(a: ModelRole | undefined, b: ModelRole | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.provider === b.provider
    && a.model === b.model
    && (a.reasoningEffort ?? undefined) === (b.reasoningEffort ?? undefined)
}

/** Extract one role route from a scope snapshot; the follow-official marker reads as unset. */
function roleValue(scope: SettingsScope<RoleRouterSettingsSection>, role: 'default' | 'planner' | 'subagent'): ModelRole | undefined {
  const value = scope.getSnapshot().value?.[role]
  return value === FOLLOW_OFFICIAL ? undefined : value
}

/**
 * Bridges the two settings scopes onto the card's staged form.
 */
export class RoleRouterCardController {
  private readonly store: SnapshotStore<RoleRouterCardState>
  private readonly staged = new Map<'default' | 'planner' | 'subagent', StagedEdit>()
  private saving = false
  private saveError: string | null = null
  private directoryState: RoleRouterDirectoryState = { groups: [], failures: [], status: 'idle', error: null, noSession: false }
  private readonly directoryDisposers: (() => void)[] = []

  /** @param scopes - the bound settings scope for the role-router namespace. */
  constructor(
    private readonly scopes: ScopePair,
    private readonly directory: RoleRouterDirectory,
  ) {
    this.store = createSnapshotStore<RoleRouterCardState>({
      available: false, exposed: false, writable: false, dirty: false, saving: false, error: null,
      default: { stored: undefined, staged: undefined, dirty: false },
      planner: { stored: undefined, staged: undefined, dirty: false },
      subagent: { stored: undefined, staged: undefined, dirty: false },
      directory: this.directoryState,
    })
    this.directoryDisposers.push(scopes.role.subscribe(() => this.project()))
    this.directoryDisposers.push(directory.store.subscribe(() => this.project()))
    this.project()
  }

  /** Recompute the card snapshot from the live scopes and staged edits. */
  private project(): void {
    const roleScope = this.scopes.role
    const roleSnap = roleScope.getSnapshot()
    this.directoryState = this.directory.store.getSnapshot()
    const fields = (role: 'default' | 'planner' | 'subagent'): RoleFieldState => {
      const stored = roleValue(roleScope, role)
      const staged = this.staged.get(role)
      const dirty = staged === UNSET_ROLE
        ? stored !== undefined
        : staged !== undefined && !sameRoute(staged, stored)
      return { stored, staged, dirty }
    }
    const defaultField = fields('default')
    const planner = fields('planner')
    const subagent = fields('subagent')
    const available = roleSnap.status !== 'loading'
    this.store.update((s) => {
      s.available = available
      s.exposed = roleSnap.status !== 'unavailable'
      s.writable = roleSnap.writable
      s.saving = this.saving
      s.error = this.saveError
      s.dirty = defaultField.dirty || planner.dirty || subagent.dirty
      s.default = defaultField
      s.planner = planner
      s.subagent = subagent
      s.directory = this.directoryState
    })
  }

  /** Stage one role's model selection. */
  edit(role: 'default' | 'planner' | 'subagent', value: ModelRole): void {
    this.saveError = null
    this.staged.set(role, value)
    this.project()
  }

  /** Stage "unset this role" (saved as a clear; the role follows the official selector). */
  clear(role: 'default' | 'planner' | 'subagent'): void {
    this.saveError = null
    this.staged.set(role, UNSET_ROLE)
    this.project()
  }

  /** Discard a role's staged edit (back to the stored value). */
  reset(role: 'default' | 'planner' | 'subagent'): void {
    this.saveError = null
    this.staged.delete(role)
    this.project()
  }

  /**
   * Write every dirty field to its namespace.
   *
   * Staged edits survive a failed write: they are cleared only after every
   * write settles successfully, so a rejected save keeps the form intact for
   * a retry (and the failure text lands in `state.error`).
   */
  async save(): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.saveError = null
    this.project()
    // Snapshot the writes first: role values are re-read from the live scope
    // so the same-route check compares against the current stored value.
    const writes: { role: 'default' | 'planner' | 'subagent'; value: RoleSettingsSectionValue }[] = []
    for (const role of ['default', 'planner', 'subagent'] as const) {
      const staged = this.staged.get(role)
      if (staged === undefined) continue
      const stored = roleValue(this.scopes.role, role)
      if (staged === UNSET_ROLE) {
        // A missing settings key would fall back to the composition layer;
        // write the explicit marker so the role follows the official
        // selector even when composition configures it. When nothing
        // configures the role either (no stored value), the marker would be
        // a no-op — drop the staged edit instead.
        if (stored === undefined) {
          this.staged.delete(role)
          continue
        }
        writes.push({ role, value: FOLLOW_OFFICIAL })
        continue
      }
      if (sameRoute(staged, stored)) continue
      writes.push({ role, value: staged })
    }
    try {
      await Promise.all(writes.map(write => this.scopes.role.set(write.role, write.value)))
      for (const write of writes) this.staged.delete(write.role)
    } catch (error) {
      this.saveError = String(error)
    } finally {
      this.saving = false
      this.project()
    }
  }

  /** Drop every staged edit. */
  discard(): void {
    this.saveError = null
    this.staged.clear()
    this.project()
  }

  /** Build the face the card's slot registration injects. */
  inject(): RoleRouterCardFace {
    return {
      hooks: { roleRouterCard: this.store },
      loadDirectory: () => { void this.directory.load() },
      edit: (role, value) => this.edit(role, value),
      clear: (role) => this.clear(role),
      reset: (role) => this.reset(role),
      save: () => this.save(),
      discard: () => this.discard(),
    }
  }

  /** Dispose controller subscriptions. */
  dispose(): void {
    for (const dispose of this.directoryDisposers) dispose()
  }
}
