/**
 * ModelSummarySeat: the composer-adjacent summary row showing the effective
 * role routes — the session's default selection (official ModelDirectory
 * current) plus the configured planner model. Purely presentational: the
 * official model seat and /model stay untouched.
 */

import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
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
  role: () => { default?: ModelRole | 'follow-official'; planner?: ModelRole } | undefined
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
  const planner = role?.planner
  // The default shown is the configured default route when set, else the
  // official session selection (which the unset default role follows).
  const configuredDefault = role?.default === 'follow-official' ? undefined : role?.default
  const defaultRoute = configuredDefault ?? (current === null
    ? undefined
    : { provider: current.provider, model: current.model })
  const defaultLabel = defaultRoute === undefined
    ? t('summary.empty')
    : displayName(directory, defaultRoute.provider, defaultRoute.model)
  const plannerLabel = planner === undefined
    ? t('summary.empty')
    : displayName(directory, planner.provider, planner.model)
  // Same hover bubble as the composer's leftmost "+" command button:
  // the official Tooltip (fixed-position bubble from the anchor rect). The
  // seat owns a full dock row and right-aligns the pill inside it.
  return (
    <div className={css.row}>
      <Tooltip
        label={`${t('summary.default')}: ${defaultLabel} · ${t('summary.planner')}: ${plannerLabel}`}
        side="top"
        delayMs={500}
      >
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
      </Tooltip>
    </div>
  )
}
