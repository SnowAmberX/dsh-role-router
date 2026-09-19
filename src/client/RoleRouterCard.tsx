/**
 * RoleRouterCard: the plugin's entry on the Plugins page. Three
 * model pickers (default / planner / subagent) over the shared catalog; the
 * default field edits the official agent-default-model section, the other two
 * edit the role-router section. Renders nothing while the namespaces load,
 * and an explanatory body when they are not served.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoleRouterCardFace, RoleRouterCardState } from './controller.ts'
import type { ModelSelectFieldProps } from './ModelSelectField.tsx'
import { ModelSelectField } from './ModelSelectField.tsx'
import type { RoleRouterKey } from './locales.ts'
import css from './RoleRouterCard.module.css'

/** Props the renderer binds for the role-router card. */
export type RoleRouterCardProps =
  PropsRuntime<'plugins.item'>
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
        dirty={props.field.dirty}
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

/** Render the editable page body and discard staged edits when it closes. */
function RoleRouterForm(props: RoleRouterCardProps & { state: RoleRouterCardState }) {
  const { state, t } = props
  const discard = useRef(props.discard)
  discard.current = props.discard
  useEffect(() => () => { discard.current() }, [])

  if (!state.available) return null
  if (!state.exposed) return <p className={css.notExposed} role="status">{t('card.notExposed')}</p>
  if (!state.writable) return <p className={css.notExposed} role="status">{t('card.notWritable')}</p>
  const blocked = !state.dirty || state.saving
  return (
    <div className={css.body}>
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
        {state.error !== null && (
          <span className={css.saveError} role="alert">{t('card.saveFailed')}: {state.error}</span>
        )}
        <button type="button" className={css.save} disabled={blocked} onClick={() => void props.save()}>
          {state.saving ? t('card.saving') : t('card.save')}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the Plugins-page one-liner or the role-router form.
 * @param props - requested view, locale copy, card snapshot, and form actions.
 */
export function RoleRouterCard(props: RoleRouterCardProps) {
  const state = props.useRoleRouterCard(snapshot => snapshot)
  if (props.view === 'summary') return props.t('card.description')
  return <RoleRouterForm {...props} state={state} />
}
