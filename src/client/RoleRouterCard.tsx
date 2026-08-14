/**
 * RoleRouterCard: the plugin's card inside the settings plugin section. Three
 * model pickers (default / planner / subagent) over the shared catalog; the
 * default field edits the official agent-default-model section, the other two
 * edit the role-router section. Renders nothing while the namespaces load,
 * and an explanatory body when they are not served.
 */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoleRouterCardFace, RoleRouterCardState } from './controller.ts'
import type { ModelSelectFieldProps } from './ModelSelectField.tsx'
import { ModelSelectField } from './ModelSelectField.tsx'
import type { RoleRouterKey } from './locales.ts'
import css from './RoleRouterCard.module.css'

/** Props the renderer binds for the role-router card. */
export type RoleRouterCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'role-router'>
  & InjectFace<RoleRouterCardFace>

/** One field row: copy + picker over the shared card state. */
function FieldRow(props: {
  t: (key: RoleRouterKey) => string
  id: string
  label: string
  hint: string
  field: RoleRouterCardState['default']
  directory: RoleRouterCardState['directory']
  writable: boolean
  onSelect: ModelSelectFieldProps['onSelect']
  onClear: () => void
  onReset: () => void
  load: () => void
}): ReactNode {
  return (
    <div className={css.field}>
      <ModelSelectField
        id={props.id}
        t={props.t}
        label={props.label}
        hint={props.hint}
        value={props.field.staged === 'unset' ? undefined : props.field.staged ?? props.field.stored}
        overridden={props.field.overridden}
        disabled={!props.writable}
        directory={props.directory}
        load={props.load}
        onSelect={props.onSelect}
        onClear={props.onClear}
        onReset={props.onReset}
      />
    </div>
  )
}

/**
 * Render the role-router settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 */
export function RoleRouterCard(props: RoleRouterCardProps) {
  const { t } = props
  const state = props.useRoleRouterCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const blocked = !state.dirty || state.saving
  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('card.title')}</span>
          <span className={css.description}>{t('card.description')}</span>
        </span>
        <span className={css.chevron} aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={css.body}>
          {!state.exposed && (
            <p className={css.notExposed} role="status">{t('card.notExposed')}</p>
          )}
          {state.exposed && !state.writable && (
            <p className={css.notExposed} role="status">{t('card.notWritable')}</p>
          )}
          {state.exposed && state.writable && (
            <>
              <FieldRow
                id="role-router-default"
                t={t}
                label={t('field.default.label')}
                hint={t('field.default.hint')}
                field={state.default}
                directory={state.directory}
                writable={state.writable}
                load={props.loadDirectory}
                onSelect={value => props.edit('default', value)}
                onClear={() => props.clear('default')}
                onReset={() => props.reset('default')}
              />
              <FieldRow
                id="role-router-planner"
                t={t}
                label={t('field.planner.label')}
                hint={t('field.planner.hint')}
                field={state.planner}
                directory={state.directory}
                writable={state.writable}
                load={props.loadDirectory}
                onSelect={value => props.edit('planner', value)}
                onClear={() => props.clear('planner')}
                onReset={() => props.reset('planner')}
              />
              <FieldRow
                id="role-router-subagent"
                t={t}
                label={t('field.subagent.label')}
                hint={t('field.subagent.hint')}
                field={state.subagent}
                directory={state.directory}
                writable={state.writable}
                load={props.loadDirectory}
                onSelect={value => props.edit('subagent', value)}
                onClear={() => props.clear('subagent')}
                onReset={() => props.reset('subagent')}
              />
              <div className={css.actions}>
                {state.dirty && <span className={css.dirtyNote} role="status">{t('card.dirty')}</span>}
                <button type="button" className={css.save} disabled={blocked} onClick={() => void props.save()}>
                  {state.saving ? t('card.saving') : t('card.save')}
                </button>
                <button type="button" className={css.discard} disabled={state.saving} onClick={props.discard}>
                  {t('card.discard')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
