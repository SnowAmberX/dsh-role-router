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
        {/* Official plugin-card chevron (same 14px icon as the product cards):
            always points down and rotates 180deg when open. */}
        <svg
          width={14}
          height={14}
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
            fill="currentColor"
          />
        </svg>
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
                {state.error !== null && (
                  <span className={css.saveError} role="alert">{t('card.saveFailed')}: {state.error}</span>
                )}
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
