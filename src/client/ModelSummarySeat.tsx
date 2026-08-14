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
  /** Current role-router settings (planner route), re-read per render. */
  role: () => { planner?: ModelRole } | undefined
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
  const defaultLabel = current === null
    ? t('summary.empty')
    : displayName(directory, current.provider, current.model)
  const plannerLabel = planner === undefined
    ? t('summary.empty')
    : displayName(directory, planner.provider, planner.model)
  return (
    <div className={css.seat} title={`${t('summary.default')}: ${defaultLabel} · ${t('summary.planner')}: ${plannerLabel}`}>
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
  )
}
