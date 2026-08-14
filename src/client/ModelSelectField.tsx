/**
 * ModelSelectField: the settings card's model picker. A button trigger shows
 * the current value (display name resolved from the catalog, fallback id);
 * the menu lists the provider-grouped catalog with inline load/retry states.
 * Simpler than the official composer ModelSelect (no per-session selection):
 * this field stages a role route, plus an optional reasoning-effort picker
 * fed by the selected model's catalog metadata.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type FocusEvent } from 'react'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelRole } from '../index.ts'
import type { RoleRouterDirectoryState } from './model-directory.ts'
import { displayModelName } from './model-directory.ts'
import type { RoleRouterKey } from './locales.ts'
import css from './ModelSelectField.module.css'

/** Props bound by the card for one role field. */
export interface ModelSelectFieldProps {
  /** Locale reader for this surface's copy. */
  t: (key: RoleRouterKey) => string
  /** Field label. */
  label: string
  /** Field hint, shown under the trigger. */
  hint?: string
  /** Current value; undefined renders the empty label. */
  value: ModelRole | undefined
  /** Whether the field holds an unsaved staged edit. */
  dirty: boolean
  /** Whether the card is writable. */
  disabled: boolean
  /** The shared catalog snapshot. */
  directory: RoleRouterDirectoryState
  /** Refresh the catalog (called on open). */
  load: () => void
  /** Pick one catalog model. */
  onSelect: (value: ModelRole) => void
  /** Unset this role (follow the official selector). */
  onClear: () => void
  /** Discard the staged edit back to the stored value. */
  onReset: () => void
  /** Field id for a11y labelling. */
  id: string
}

/** The selected model's selectable reasoning efforts, or undefined when absent. */
function effortsOf(
  directory: RoleRouterDirectoryState,
  route: ModelRole | undefined,
): ModelReasoningEffort[] | undefined {
  if (route === undefined) return undefined
  const group = directory.groups.find(candidate => candidate.id === route.provider)
  const model = group?.models.find(candidate => candidate.id === route.model)
  const efforts = model?.reasoning?.efforts
  return efforts === undefined || efforts.length === 0 ? undefined : efforts
}

/**
 * Render one role's model picker.
 * @param props - the field's copy, value, catalog, and actions.
 */
export function ModelSelectField(props: ModelSelectFieldProps) {
  const { t, directory, disabled } = props
  const value = props.value
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const id = useId()
  const menuId = `${id}-menu`
  const effortId = `${id}-effort`

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // Refresh the catalog on every open (loads on first open too). The load
  // face is a stable closure from the controller's inject(), so it is a safe
  // dependency; the whole props object must NOT be — it changes every parent
  // render and would re-trigger loads on every directory state flip.
  useEffect(() => {
    if (open) props.load()
  }, [open, props.load])

  const close = (): void => setOpen(false)
  const triggerLabel = value === undefined
    ? t('field.unset')
    : displayModelName(directory, value.provider, value.model)
  const efforts = effortsOf(directory, value)

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        id={props.id}
        type="button"
        className={css.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${props.label}: ${triggerLabel}`}
        disabled={disabled}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.triggerLabel}>{triggerLabel}</span>
        {/* Official composer ModelSelect chevron: always points down, rotates 180deg when open. */}
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
      {props.hint !== undefined && <div className={css.hint}>{props.hint}</div>}
      {efforts !== undefined && value !== undefined && (
        <div className={css.effort}>
          <label className={css.effortLabel} htmlFor={effortId}>{t('field.effort.label')}</label>
          <select
            id={effortId}
            className={css.effortSelect}
            disabled={disabled}
            value={value.reasoningEffort ?? ''}
            onChange={(event) => {
              const selected = event.target.value
              props.onSelect({
                provider: value.provider,
                model: value.model,
                ...(selected === '' ? {} : { reasoningEffort: selected }),
              })
            }}
          >
            <option value="">{t('field.effort.unset')}</option>
            {efforts.map(effort => (
              <option key={effort.id} value={effort.id}>{effort.name}</option>
            ))}
          </select>
        </div>
      )}
      {/* Reset only makes sense while this field carries an unsaved edit:
          it discards the staged change back to the stored value. */}
      {props.dirty && !props.disabled && (
        <button type="button" className={css.reset} onClick={props.onReset}>
          {t('card.reset')}
        </button>
      )}

      {open && (
        <div id={menuId} className={css.menu} role="listbox" aria-label={props.label}>
          <button
            type="button"
            role="option"
            aria-selected={value === undefined}
            className={css.option}
            onClick={() => {
              props.onClear()
              close()
            }}
          >
            <span className={css.optionCopy}>
              <span className={css.modelName}>{t('field.unset')}</span>
              <span className={css.description}>{t('field.unsetHint')}</span>
            </span>
            <span className={css.check} aria-hidden>{value === undefined ? '✓' : ''}</span>
          </button>
          {/* Loading hint only while nothing is cached yet: with a previous
              load in hand the list shows immediately and refreshes silently
              in the background (avoids flashing "loading" over stale data). */}
          {directory.status === 'loading' && directory.groups.length === 0 && (
            <div className={css.status} role="status">{t('directory.loading')}</div>
          )}
          {directory.status === 'error' && (
            <div className={css.error}>
              <span>{t('directory.error')}: {directory.error}</span>
              <button type="button" className={css.retry} onClick={props.load}>{t('directory.retry')}</button>
            </div>
          )}
          {directory.status === 'ready' && directory.groups.length === 0 && (
            <div className={css.status}>
              {directory.noSession ? t('directory.noSession') : t('directory.empty')}
            </div>
          )}
          {directory.failures.map(failure => (
            <div className={css.warning} key={failure.id}>
              <span>{t('directory.groupFailed')}{failure.name ? `: ${failure.name}` : ''}</span>
            </div>
          ))}
          {directory.groups.map(group => (
            <section role="group" aria-label={group.name} className={css.group} key={group.id}>
              <div className={css.groupTitle}>{group.name}</div>
              {group.models.map(model => {
                const selected = props.value?.provider === group.id && props.value.model === model.id
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={css.option}
                    key={model.id}
                    title={model.name}
                    onClick={() => {
                      props.onSelect({ provider: group.id, model: model.id })
                      close()
                    }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{model.name}</span>
                      {model.description !== undefined && (
                        <span className={css.description}>{model.description}</span>
                      )}
                    </span>
                    <span className={css.check} aria-hidden>{selected ? '✓' : ''}</span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
