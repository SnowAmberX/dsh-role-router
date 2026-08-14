/**
 * ModelSummarySeat: the composer-adjacent summary row showing the effective
 * role routes — the session's default selection (official ModelDirectory
 * current) plus the configured planner model. Purely presentational: the
 * official model seat and /model stay untouched.
 */

import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelRole } from '../index.ts'
import type { RoleRouterKey } from './locales.ts'
import css from './ModelSummarySeat.module.css'

/** Injected face of the summary seat. */
export interface ModelSummarySeatInjected {
  /** The session's shared model directory (official). */
  directory: SnapshotStore<ModelDirectoryState>
  /**
   * Current role-router settings (default + planner routes), re-read per
   * render; the follow-official marker reads as unset.
   */
  role: () => { default?: ModelRole | 'follow-official'; planner?: ModelRole | 'follow-official' } | undefined
}

/** Display name of one route from the directory groups, fallback model id. */
function displayName(state: ModelDirectoryState, provider: string, model: string): string {
  const group = state.groups.find(candidate => candidate.id === provider)
  const entry = group?.models.find(candidate => candidate.id === model)
  return entry?.name ?? model
}

/** Props bound by the composer slot for the summary seat. */
export type ModelSummarySeatProps = ModelSummarySeatInjected & {
  /** Locale reader for this surface's copy. */
  t: (key: RoleRouterKey) => string
}

/**
 * Render the role summary row.
 * @param props - the session directory, the role settings, and locale copy.
 */
export function ModelSummarySeat(props: ModelSummarySeatProps) {
  const { t } = props
  const directory = useSyncExternalStore(
    fn => props.directory.subscribe(fn),
    () => props.directory.getSnapshot(),
  )
  const role = props.role()
  const current = directory.current
  // The follow-official marker reads as unset for both roles shown.
  const configuredDefault = role?.default === 'follow-official' ? undefined : role?.default
  const planner = role?.planner === 'follow-official' ? undefined : role?.planner
  // The default shown is the configured default route when set, else the
  // official session selection (which the unset default role follows).
  const defaultRoute = configuredDefault ?? (current === null
    ? undefined
    : { provider: current.provider, model: current.model })
  const defaultLabel = defaultRoute === undefined
    ? t('summary.empty')
    : displayName(directory, defaultRoute.provider, defaultRoute.model)
  const plannerLabel = planner === undefined
    ? t('summary.empty')
    : displayName(directory, planner.provider, planner.model)
  // The seat owns one dock row and centers the pill; the dock row is wide
  // enough for full model names, so no hover bubble is needed.
  return (
    <div className={css.row}>
      <div className={css.seat}>
        <span className={css.part}>
          <span className={css.name}>{t('summary.default')}</span>
          <span className={css.value}>{defaultLabel}</span>
        </span>
        <span className={css.sep} aria-hidden>·</span>
        <span className={css.part}>
          <span className={css.name}>{t('summary.planner')}</span>
          <span className={css.value}>{plannerLabel}</span>
        </span>
      </div>
    </div>
  )
}
