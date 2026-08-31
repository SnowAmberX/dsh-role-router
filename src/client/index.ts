/**
 * Role-router client plugin: the settings card (default/planner/subagent
 * model pickers) and the composer-adjacent role summary. All three card
 * fields edit the `role-router` settings section this plugin's host half
 * serves: a configured role FORCES its model on matching requests, an unset
 * role follows the official model selector. The settings section is
 * registered with the composition entry as its base layer, so the card shows
 * and can override composition-configured routes too.
 *
 * The card's catalog is the Host-generation global model catalog
 * (`ctx.remote.session.modelCatalog()`), so the three pickers load without a
 * current Session; the composer summary keeps the official per-session
 * `modelDirectories` directory, which is the effective model for the open
 * Session.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelRole } from '../index.ts'
// Type-only edges: the slot registry (renderer), the locale merge, the
// settingsScope merge, the composer seat declarations, the official
// settings-card slot declaration, the official model-directory service
// declaration, the remote carrier (ClientRemote + forwarded events), and the
// connection lifecycle events.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
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
  default?: ModelRole | 'follow-official'
  planner?: ModelRole | 'follow-official'
  subagent?: ModelRole | 'follow-official'
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'settingsScope', 'locale', 'remote', 'remote.session', 'modelDirectories']

/**
 * Mount the settings card and the composer summary.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'role-router: dictionaries')

  const roleScope = ctx.settingsScope.bind<RoleRouterSettingsSection>({ namespace: ROLE_ROUTER_NS })

  // Shared catalog for the card's pickers: the Host-generation global catalog
  // served through the session remote, with no Session dependency. Refreshes
  // ride the same forwarded signals the official model directory watches, and
  // a connection reset starts a new Host generation.
  const directory = new RoleRouterDirectory(ctx.remote.session)
  const refresh = (): void => directory.refresh()
  const stopRemote = [
    ctx.remote.$on('llm/adapters-updated', refresh),
    ctx.remote.$on('settings/document-updated', refresh),
    ctx.remote.$on('credentials/reference-updated', refresh),
  ]
  ctx.on('connection/reset', () => directory.resetGeneration())
  ctx.effect(() => () => {
    for (const dispose of stopRemote) dispose()
    directory.dispose()
  }, 'role-router: model directory')
  // Preload the catalog on apply: without this the fields render model ids
  // and hide the reasoning-effort picker until the menu's first open.
  void directory.load().catch(() => { /* surfaced on the store */ })

  // The settings card: staged form over the role-router namespace.
  // `settings.plugin.item` is a keyed slot (key = the settings namespace the
  // card edits), so the registration MUST carry `key` — a missing key fails
  // the whole client apply.
  const card = new RoleRouterCardController({ role: roleScope }, directory)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: ROLE_ROUTER_NS,
    locale: NS,
    inject: () => card.inject(),
  }, RoleRouterCard))
  ctx.effect(() => () => card.dispose(), 'role-router: settings card')

  // The composer-adjacent summary: session default + planner route. Lives in
  // the input dock above the todo card (negative order beats the plan strip's
  // order 0), centered on its own row so it never squeezes the tool row's
  // plan chip, model seat, or the approval panel that takes over the composer.
  // This one IS per-session: it shows the open Session's effective model, so
  // it resolves through the official per-session model directory.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'role-router-models',
    order: -10,
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
