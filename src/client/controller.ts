/**
 * Settings-card controller: staged form over TWO settings namespaces — the
 * official `agent-default-model` section for the default-model fields and the
 * `role-router` section for the planner/subagent roles. Writes are
 * field-level (`SettingsScope.set`), so the default model's reasoningEffort
 * survives untouched and the role objects are replaced as whole fields.
 */

import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelRole } from '../index.ts'
import type { RoleRouterDirectory, RoleRouterDirectoryState } from './model-directory.ts'

/** The official agent-default-model settings section (spelled, not imported — client must not depend on the Host package). */
export interface AgentDefaultModelSettings {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** One card field: the stored value, the staged edit, and override state. */
export interface RoleFieldState {
  /** Stored value (settings or composition layer). */
  stored: ModelRole | undefined
  /** Staged edit; undefined means the stored value. */
  staged: ModelRole | undefined
  /** Whether the user layer carries an override for this field. */
  overridden: boolean
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
  /** Clear a role's staged edit (back to the stored value). */
  reset(role: 'default' | 'planner' | 'subagent'): void
  /** Write every dirty field to its namespace. */
  save(): Promise<void>
  /** Drop every staged edit. */
  discard(): void
}

/** The card's per-field write face per namespace. */
interface ScopePair {
  default: SettingsScope<AgentDefaultModelSettings>
  role: SettingsScope<{ planner?: ModelRole; subagent?: ModelRole }>
}

/** Deep-compare two role routes (reference-equal when both undefined). */
function sameRoute(a: ModelRole | undefined, b: ModelRole | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.provider === b.provider && a.model === b.model
}

/** Extract one role route from a scope snapshot. */
function roleValue(scope: SettingsScope<{ planner?: ModelRole; subagent?: ModelRole }>, role: 'planner' | 'subagent'): ModelRole | undefined {
  return scope.getSnapshot().value?.[role]
}

/** Whether the user layer overrides one role object. */
function roleOverridden(
  scope: SettingsScope<{ planner?: ModelRole; subagent?: ModelRole }>,
  role: 'planner' | 'subagent',
): boolean {
  const user = scope.getSnapshot().user as { planner?: unknown; subagent?: unknown } | undefined
  return user?.[role] !== undefined
}

/** Whether the user layer overrides the default model's provider (proxy for the pair). */
function defaultOverridden(scope: SettingsScope<AgentDefaultModelSettings>): boolean {
  const user = scope.getSnapshot().user as { provider?: unknown } | undefined
  return user?.provider !== undefined
}

/** The stored default route from the official section. */
function defaultStored(scope: SettingsScope<AgentDefaultModelSettings>): ModelRole | undefined {
  const value = scope.getSnapshot().value
  if (value?.provider === undefined || value.model === undefined) return undefined
  return { provider: value.provider, model: value.model }
}

/**
 * Bridges the two settings scopes onto the card's staged form.
 */
export class RoleRouterCardController {
  private readonly store: SnapshotStore<RoleRouterCardState>
  private readonly staged = new Map<'default' | 'planner' | 'subagent', ModelRole | undefined>()
  private saving = false
  private directoryState: RoleRouterDirectoryState = { groups: [], failures: [], status: 'idle', error: null }
  private readonly directoryDisposers: (() => void)[] = []

  /** @param scopes - the bound settings scopes for both namespaces. */
  constructor(
    private readonly scopes: ScopePair,
    private readonly directory: RoleRouterDirectory,
  ) {
    this.store = createSnapshotStore<RoleRouterCardState>({
      available: false, exposed: false, writable: false, dirty: false, saving: false,
      default: { stored: undefined, staged: undefined, overridden: false, dirty: false },
      planner: { stored: undefined, staged: undefined, overridden: false, dirty: false },
      subagent: { stored: undefined, staged: undefined, overridden: false, dirty: false },
      directory: this.directoryState,
    })
    for (const scope of [scopes.default, scopes.role]) {
      this.directoryDisposers.push(scope.subscribe(() => this.project()))
    }
    this.directoryDisposers.push(directory.store.subscribe(() => this.project()))
    this.project()
  }

  /** Recompute the card snapshot from the live scopes and staged edits. */
  private project(): void {
    const defaultScope = this.scopes.default
    const roleScope = this.scopes.role
    const defaultSnap = defaultScope.getSnapshot()
    const roleSnap = roleScope.getSnapshot()
    this.directoryState = this.directory.store.getSnapshot()
    const fields = (role: 'default' | 'planner' | 'subagent'): RoleFieldState => {
      const stored = role === 'default'
        ? defaultStored(defaultScope)
        : roleValue(roleScope, role)
      const overridden = role === 'default'
        ? defaultOverridden(defaultScope)
        : roleOverridden(roleScope, role)
      const staged = this.staged.get(role)
      return { stored, staged, overridden, dirty: staged !== undefined && !sameRoute(staged, stored) }
    }
    const defaultField = fields('default')
    const planner = fields('planner')
    const subagent = fields('subagent')
    const available = defaultSnap.status !== 'loading' && roleSnap.status !== 'loading'
    this.store.update((s) => {
      s.available = available
      s.exposed = defaultSnap.status !== 'unavailable' && roleSnap.status !== 'unavailable'
      s.writable = defaultSnap.writable && roleSnap.writable
      s.saving = this.saving
      s.dirty = defaultField.dirty || planner.dirty || subagent.dirty
      s.default = defaultField
      s.planner = planner
      s.subagent = subagent
      s.directory = this.directoryState
    })
  }

  /** Stage one role's model selection. */
  edit(role: 'default' | 'planner' | 'subagent', value: ModelRole): void {
    this.staged.set(role, value)
    this.project()
  }

  /** Clear a role's staged edit (back to the stored value). */
  reset(role: 'default' | 'planner' | 'subagent'): void {
    this.staged.delete(role)
    this.project()
  }

  /** Write every dirty field to its namespace. */
  async save(): Promise<void> {
    this.saving = true
    this.project()
    try {
      const writes: Promise<void>[] = []
      for (const role of ['default', 'planner', 'subagent'] as const) {
        const staged = this.staged.get(role)
        if (staged === undefined) continue
        const stored = role === 'default'
          ? defaultStored(this.scopes.default)
          : roleValue(this.scopes.role, role)
        if (sameRoute(staged, stored)) continue
        if (role === 'default') {
          writes.push(this.scopes.default.set('provider', staged.provider))
          writes.push(this.scopes.default.set('model', staged.model))
        } else {
          writes.push(this.scopes.role.set(role, staged))
        }
        this.staged.delete(role)
      }
      await Promise.all(writes)
    } finally {
      this.saving = false
      this.project()
    }
  }

  /** Drop every staged edit. */
  discard(): void {
    this.staged.clear()
    this.project()
  }

  /** Build the face the card's slot registration injects. */
  inject(): RoleRouterCardFace {
    return {
      hooks: { roleRouterCard: this.store },
      loadDirectory: () => { void this.directory.load() },
      edit: (role, value) => this.edit(role, value),
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
