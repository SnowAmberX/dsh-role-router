/**
 * Role-based model routing for DeepSeek Harness agents.
 *
 * Every agent request is routed by role:
 * - the `default` role is the OFFICIAL session model selection (the composer
 *   model seat / `/model` / agent-default-model settings). Requests in the
 *   default mode pass through untouched — the official selection IS the
 *   default role, so per-session switches keep working.
 * - the `planner` role (top-level agents while plan mode is active) and the
 *   `subagent` role (every in-process subagent, any nesting depth) come from
 *   this plugin's own configuration, layered as settings document over
 *   composition config; an unset role passes the request through (it then
 *   follows the session's default selection).
 *
 * The routing listeners are registered on the ROOT context, so they observe
 * every agent's `agent/request` and `system-prompt/assemble` dispatch —
 * including in-process subagents, whose scope chain still reaches the global
 * listener layer. Plan mode is read from the durable session log
 * (`plan/mode`, folded by `foldPlanMode`) — by the time `agent/request`
 * dispatches, an accepted pre-step has already flushed any pending selection,
 * so the fold matches exactly what the model saw in the `plan:policy`
 * section. `ctx.planMode` is consulted first when visible (pending-aware),
 * with the fold as the realm-independent fallback.
 *
 * Requests are never mutated: the loop's seed config is deep-frozen, so the
 * listener returns a replacement object. Switching models drops an inherited
 * adapter-owned `reasoningEffort` (the routed model may not support the
 * previous model's effort; `prepareCall` rejects unsupported explicit
 * efforts), while sampling scalars carry over. The default role never
 * switches, so its effort is preserved.
 *
 * Auxiliary model calls (compaction, session-title) do not dispatch through
 * `agent/request` and are intentionally unaffected, as are out-of-process
 * subagent providers (acp, codex, …) whose requests never reach this
 * process's agent loop.
 *
 * @module @SnowAmberX/dsh-role-router
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only edges: resolve the agent-scoped event declarations and the
// plan-mode service augmentation onto the Cordis context.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** The plugin's stable Cordis identity. */
export const name = 'role-router'

/** One role's provider/model route. */
export interface ModelRole {
  /** Registered provider route (must have a registered adapter at request time). */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
}

/** Plugin config: the `default` role is required (composition fallback); the other roles are optional. */
export interface Config {
  /**
   * Composition fallback for the `default` role. The default role's LIVE
   * value is the official agent-default-model selection; this entry only
   * participates when that service is absent.
   */
  default: ModelRole
  /** Role used by top-level agents while plan mode is active; unset passes through. */
  planner?: ModelRole
  /** Role used by in-process subagents in every mode; unset passes through. */
  subagent?: ModelRole
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  default: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }),
  // Preserve omission: Schemastery would otherwise materialize `{}`.
  planner: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default(undefined as unknown as ModelRole),
  subagent: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default(undefined as unknown as ModelRole),
})

/** Settings namespace owning the user-configured role routes. */
export const ROLE_ROUTER_SETTINGS_NAMESPACE = settingsNamespace('role-router')

/** User settings: per-role routes beyond the session's default selection. */
export interface RoleRouterSettings {
  /**
   * The default model for new sessions. The host half mirrors this into the
   * official agent-default-model settings (effort preserved), because the
   * api-proxy settings allowlist exposes only model-provider namespaces and
   * the hard-coded Web/product lists.
   */
  default?: ModelRole
  /** Role used by top-level agents while plan mode is active. */
  planner?: ModelRole
  /** Role used by in-process subagents in every mode. */
  subagent?: ModelRole
}

/** Schemastery validation for {@link RoleRouterSettings}. */
export const RoleRouterSettingsSchema: z<RoleRouterSettings> = z.object({
  default: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default(undefined as unknown as ModelRole),
  planner: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default(undefined as unknown as ModelRole),
  subagent: z.object({
    provider: z.string().required(),
    model: z.string().required(),
  }).default(undefined as unknown as ModelRole),
})

/** Resolved composition config: the default role is concrete, the others stay optional. */
export interface ResolvedConfig {
  default: ModelRole
  planner?: ModelRole
  subagent?: ModelRole
}

/** The routing role of one agent request. */
export type AgentRole = 'default' | 'planner' | 'subagent'

/**
 * Classify one agent request by its role.
 * @param origin - the session header's coarse origin (`'subagent'` for a delegated child).
 * @param planActive - whether plan mode is in force for the requesting agent.
 * @returns the role that owns the request's model route.
 */
export function classify(origin: string | undefined, planActive: boolean): AgentRole {
  if (origin === 'subagent') return 'subagent'
  return planActive ? 'planner' : 'default'
}

/**
 * Validate and resolve raw plugin config. A missing or blank `default`
 * provider/model and unknown keys fail at load rather than being ignored;
 * unset `planner`/`subagent` roles stay unset (the request then passes
 * through and follows the session's default selection).
 * @param config - raw plugin config.
 * @returns a resolved config with the default role concrete.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const unknown = Object.keys(config).filter(key => !['default', 'planner', 'subagent'].includes(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-role-router config has unknown key(s) ${unknown.join(', ')} — config is { default, planner?, subagent? }`)
  }
  return {
    default: checkRole('default', config.default),
    planner: config.planner === undefined ? undefined : checkRole('planner', config.planner),
    subagent: config.subagent === undefined ? undefined : checkRole('subagent', config.subagent),
  }
}

/** Validate one role's provider/model route. */
function checkRole(label: string, role: ModelRole | undefined): ModelRole {
  if (role === undefined) throw new Error(`dsh-role-router config needs a ${label} role`)
  if (typeof role.provider !== 'string' || role.provider.trim() === '') {
    throw new Error(`dsh-role-router ${label} role needs a non-empty provider`)
  }
  if (typeof role.model !== 'string' || role.model.trim() === '') {
    throw new Error(`dsh-role-router ${label} role needs a non-empty model`)
  }
  return { provider: role.provider, model: role.model }
}

/** Whether plan mode is in force for the agent's next request. */
function planActive(ctx: Context, agent: Agent): boolean {
  const controller = ctx.get('planMode')
  if (controller !== undefined) {
    const state = controller.get(agent)
    return state.pending ?? state.active
  }
  return foldPlanMode(agent.session.events)
}

/**
 * Apply one role's route to a resolved request config. An inherited
 * adapter-owned `reasoningEffort` is dropped: the routed model may not support
 * the previous model's effort (`prepareCall` rejects unsupported explicit
 * efforts without clamping). Sampling scalars stay model-agnostic and carry
 * over. Returns the input unchanged when the route already matches.
 * @param resolved - the config after downstream listeners.
 * @param target - the role's route to apply.
 * @returns a replacement config, never a mutation.
 */
export function switchRoute(resolved: LlmCallConfig, target: ModelRole): LlmCallConfig {
  if (resolved.provider === target.provider && resolved.model === target.model) return resolved
  const { reasoningEffort: _effort, ...rest } = resolved
  return { ...rest, provider: target.provider, model: target.model }
}

export function apply(ctx: Context, config: Config): void {
  const composition = resolveConfig(config)
  // User settings (the settings card) layer over the composition entry; the
  // source thunk is re-read per request so a saved setting applies to the
  // next request without a restart. No settings service mounted keeps the
  // composition values.
  let source: () => RoleRouterSettings = () => ({})
  installSettingsSection(ctx, ROLE_ROUTER_SETTINGS_NAMESPACE, RoleRouterSettingsSchema, {
    planner: composition.planner,
    subagent: composition.subagent,
  }, {
    setSource: current => { source = current },
    onChange: () => syncDefaultToOfficial(),
  })

  // Expose the role-router settings namespace to Web configuration clients:
  // the api-proxy settings allowlist serves model-provider namespaces plus a
  // hard-coded Web/product list, and moving namespace exposure into
  // settings.register() is deferred upstream work. Registering a
  // configurable-provider directory entry is the sanctioned way for a plugin
  // to declare a settings namespace the configuration boundary serves.
  const llm = ctx.get('llm')
  if (llm !== undefined) {
    llm.registerConfigurableProviders([{
      provider: 'role-router',
      displayName: 'Role router (model routing)',
      settingsNs: ROLE_ROUTER_SETTINGS_NAMESPACE,
      settingsPath: [],
    }])
  }

  /**
   * Mirror the configured default route into the official agent-default-model
   * settings (effort preserved), so a card save becomes the new-session
   * default selection. Host-side writes bypass the api-proxy allowlist; the
   * equality check keeps the mirror idempotent against the update it fires.
   */
  function syncDefaultToOfficial(): void {
    const settings = ctx.get('settings')
    const official = ctx.get('agentDefaultModel')
    const selected = source().default
    if (settings === undefined || official === undefined || selected === undefined) return
    const current = official.currentSelection()
    if (current.provider === selected.provider && current.model === selected.model) return
    void settings.replace(settingsNamespace('agent-default-model'), {
      provider: selected.provider,
      model: selected.model,
      ...current.reasoningEffort === undefined ? {} : { reasoningEffort: String(current.reasoningEffort) },
    })
  }

  /** The override route for one request, or undefined to pass through. */
  const roleTarget = (agent: Agent): ModelRole | undefined => {
    const role = classify(agent.session.header.origin, planActive(ctx, agent))
    if (role === 'default') return undefined
    const settings = source()
    return settings[role] ?? composition[role]
  }

  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    const target = roleTarget(agent)
    return target === undefined ? resolved : switchRoute(resolved, target)
  })

  // Keep the assembled `{{provider}}`/`{{model}}` persona variables in step
  // with an applied role route, mirroring installModelSelection's
  // prompt/request coupling (model-selection.ts). Pass-through requests keep
  // whatever the official selection assembled.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const target = roleTarget(agent)
    if (target === undefined) return assembled
    return {
      ...assembled,
      variables: { ...assembled.variables, provider: target.provider, model: target.model },
    }
  })
}
