/**
 * Role-router client plugin: the settings card (default/planner/subagent
 * model pickers) and the composer-adjacent role summary. The card's default
 * fields edit the official `agent-default-model` settings section, so the
 * configured default IS the new-session default selection; planner/subagent
 * live in the `role-router` section this plugin's host half serves.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */

import type { ClientContext, SessionId, SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ModelRole } from '../index.ts'
// Type-only edges: the slot registry, the locale merge, the settingsScope
// merge, the composer seat declarations, the official settings-card slot
// declaration, and the official model-directory service declaration.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { RoleRouterCard } from './RoleRouterCard.tsx'
import { RoleRouterCardController } from './controller.ts'
import { ModelSummarySeat } from './ModelSummarySeat.tsx'
import { RoleRouterDirectory } from './model-directory.ts'
import { dictionaries, type RoleRouterKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'role-router'

/** The role-router settings namespace this plugin's host half registers and exposes. */
const ROLE_ROUTER_NS = 'role-router'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Role-router surface copy. */
    'role-router': RoleRouterKey
  }
}

/** The role-router settings section shape. */
interface RoleRouterSettingsSection {
  default?: ModelRole
  planner?: ModelRole
  subagent?: ModelRole
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'settingsScope', 'locale', 'connection', 'sessions', 'remote', 'modelDirectories']

/** The current session id, or undefined in no-session mode. */
function currentSessionId(ctx: ClientContext): SessionId | undefined {
  const sessions = ctx.get('sessions') as unknown as SessionRuntime
  const info = sessions.currentProvideInfo.getSnapshot()
  return info.sessionId === undefined ? undefined : info.sessionId as SessionId
}

/**
 * Mount the settings card and the composer summary.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'role-router: dictionaries')

  const roleScope = ctx.settingsScope.bind<RoleRouterSettingsSection>({ namespace: ROLE_ROUTER_NS })

  // Shared catalog for the card's pickers: global groups served through the
  // current session's models RPC.
  const connection = ctx.get('connection') as ConnectionHandle
  const directory = new RoleRouterDirectory(connection.api.sessions, () => currentSessionId(ctx))
  const refresh = (): void => { void directory.load().catch(() => undefined) }
  const remote = ctx.get('remote') as unknown as { $on(event: string, fn: () => void): () => void }
  const stopRemote = [
    remote.$on('llm/adapters-updated', refresh),
    remote.$on('settings/document-updated', refresh),
  ]
  ctx.effect(() => () => {
    for (const dispose of stopRemote) dispose()
    directory.dispose()
  }, 'role-router: model directory')

  // The settings card: staged form over both namespaces.
  const card = new RoleRouterCardController({ role: roleScope }, directory)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'role-router',
    order: 200,
    locale: NS,
    inject: () => card.inject(),
  }, RoleRouterCard))
  ctx.effect(() => () => card.dispose(), 'role-router: settings card')

  // The composer-adjacent summary: session default + planner route. Lives in
  // the input dock (its own row above the composer card) so the summary
  // right-aligns without squeezing the tool row's plan chip, model seat, or
  // the approval panel that takes over the composer.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'role-router-models',
    order: 200,
    locale: NS,
    inject: (sessionId) => {
      const directory = ctx.modelDirectories.directoryFor(sessionId)
      return {
        directory: directory.store,
        role: () => roleScope.getSnapshot().value,
      }
    },
  }, ModelSummarySeat))
}
