/**
 * Role-based model routing for DeepSeek Harness agents.
 *
 * Every agent request is routed by role, with one uniform rule: a role that
 * is configured (settings document over composition config) forces that
 * model; an unset role passes the request through untouched, so the official
 * layered selection applies (per-session composer pick > the session's own
 * latest logged request > the global agent-default-model default — the same
 * precedence the harness's per-agent model-selection layer resolves).
 * - `default`  — top-level agents outside plan mode
 * - `planner`  — top-level agents while plan mode is active
 * - `subagent` — every in-process subagent (any nesting depth)
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
 * adapter-owned `reasoningEffort` unless the route sets one explicitly (the
 * routed model may not support the previous model's effort; `prepareCall`
 * rejects unsupported explicit efforts without clamping), while sampling
 * scalars carry over. Unset roles pass through, preserving whatever the
 * official selection layer assembled (including its effort).
 *
 * Known interplay: a forced planner route is persisted into the session's
 * request header, and the official "latest logged request" layer would then
 * treat it as the session's current model. To keep follow-official honest,
 * the plugin snapshots the official route at the plan-entry edge and, at the
 * plan-exit edge, restores it once for an unset default role — after which
 * the request passes through again. The restore is edge-scoped: an
 * unconfigured planner never snapshots (nothing polluted the header), and a
 * fixed default role takes precedence over the snapshot. `assemble` reads
 * the same edge (restoring the persona variables before `agent/request`
 * restores the config), so the first post-plan turn never pairs a planner
 * persona with a restored request.
 *
 * Auxiliary model calls (compaction, session-title) do not dispatch through
 * `agent/request` and are intentionally unaffected, as are out-of-process
 * subagent providers (acp, codex, …) whose requests never reach this
 * process's agent loop.
 *
 * @module @snowamberx/dsh-role-router
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only edges: resolve the agent-scoped event declarations and the
// plan-mode service augmentation onto the Cordis context.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** The plugin's stable Cordis identity. */
export const name = 'role-router'

/** One role's provider/model route. */
export interface ModelRole {
  /** Registered provider route (must have a registered adapter at request time). */
  provider: string
  /** Model id interpreted by the selected provider adapter. */
  model: string
  /** Adapter-owned reasoning effort; unset drops inherited effort (target adapter default). */
  reasoningEffort?: string
}

/** Plugin config: every role is optional; an unset role follows the official selection. */
export interface Config {
  /** Role used by top-level agents outside plan mode; unset follows the official selection. */
  default?: ModelRole
  /** Role used by top-level agents while plan mode is active; unset follows the official selection. */
  planner?: ModelRole
  /** Role used by in-process subagents in every mode; unset follows the official selection. */
  subagent?: ModelRole
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  default: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }).default(undefined as unknown as Required<ModelRole>),
  planner: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }).default(undefined as unknown as Required<ModelRole>),
  subagent: z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }).default(undefined as unknown as Required<ModelRole>),
})

/** Settings namespace owning the user-configured role routes. */
export const ROLE_ROUTER_SETTINGS_NAMESPACE = settingsNamespace('role-router')

/**
 * Settings sentinel for "this role is explicitly unset": the request follows
 * the official selection even when the composition layer configures the role.
 * A missing key cannot express that (it would fall back to composition), so
 * the settings card writes this marker instead of clearing the field.
 */
export const FOLLOW_OFFICIAL = 'follow-official' as const

/** One configured role route, or the explicit follow-official marker. */
export type RoleSettingsValue = ModelRole | typeof FOLLOW_OFFICIAL

/** User settings: per-role routes; the follow-official marker wins over composition. */
export interface RoleRouterSettings {
  /** Role used by top-level agents outside plan mode. */
  default?: RoleSettingsValue
  /** Role used by top-level agents while plan mode is active. */
  planner?: RoleSettingsValue
  /** Role used by in-process subagents in every mode. */
  subagent?: RoleSettingsValue
}

/** Schemastery validation for {@link RoleRouterSettings}. */
const roleSettingsValue = z.union([
  z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  }),
  z.const(FOLLOW_OFFICIAL),
])
export const RoleRouterSettingsSchema: z<RoleRouterSettings> = z.object({
  default: roleSettingsValue.default(undefined as unknown as never),
  planner: roleSettingsValue.default(undefined as unknown as never),
  subagent: roleSettingsValue.default(undefined as unknown as never),
})

/** Resolved composition config: every role is optional. */
export interface ResolvedConfig {
  default?: ModelRole
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
 * Validate and resolve raw plugin config. Unknown keys and blank values fail
 * at load rather than being ignored; unset roles stay unset (the request then
 * follows the official selection).
 * @param config - raw plugin config.
 * @returns a resolved config with every role optional.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const unknown = Object.keys(config).filter(key => !['default', 'planner', 'subagent'].includes(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-role-router config has unknown key(s) ${unknown.join(', ')} — config is { default?, planner?, subagent? }`)
  }
  return {
    default: config.default === undefined ? undefined : checkRole('default', config.default),
    planner: config.planner === undefined ? undefined : checkRole('planner', config.planner),
    subagent: config.subagent === undefined ? undefined : checkRole('subagent', config.subagent),
  }
}

/** Validate one role's provider/model route and optional reasoning effort. */
function checkRole(label: string, role: ModelRole | undefined): ModelRole {
  if (role === undefined) throw new Error(`dsh-role-router config needs a ${label} role`)
  if (typeof role.provider !== 'string' || role.provider.trim() === '') {
    throw new Error(`dsh-role-router ${label} role needs a non-empty provider`)
  }
  if (typeof role.model !== 'string' || role.model.trim() === '') {
    throw new Error(`dsh-role-router ${label} role needs a non-empty model`)
  }
  if (role.reasoningEffort !== undefined
    && (typeof role.reasoningEffort !== 'string' || role.reasoningEffort.trim() === '')) {
    throw new Error(`dsh-role-router ${label} role needs a non-empty reasoningEffort`)
  }
  return {
    provider: role.provider,
    model: role.model,
    ...role.reasoningEffort === undefined ? {} : { reasoningEffort: role.reasoningEffort },
  }
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
 * Apply one role's route to a resolved request config. When the route changes,
 * an inherited adapter-owned `reasoningEffort` is dropped (the routed model may
 * not support the previous model's effort; `prepareCall` rejects unsupported
 * explicit efforts without clamping) unless the role configures an explicit
 * `reasoningEffort`, which is applied instead. Sampling scalars stay
 * model-agnostic and carry over. Returns the input unchanged when the route
 * already matches and the role sets no effort.
 * @param resolved - the config after downstream listeners.
 * @param target - the role's route to apply.
 * @returns a replacement config, never a mutation.
 */
export function switchRoute(resolved: LlmCallConfig, target: ModelRole): LlmCallConfig {
  const sameRoute = resolved.provider === target.provider && resolved.model === target.model
  const effort = target.reasoningEffort
  if (sameRoute && effort === undefined) return resolved
  const { reasoningEffort: _inherited, ...rest } = resolved
  return {
    ...(sameRoute ? resolved : rest),
    provider: target.provider,
    model: target.model,
    ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
  }
}

export function apply(ctx: Context, config: Config): void {
  const composition = resolveConfig(config)
  // User settings (the settings card) layer over the composition entry; the
  // source thunk is re-read per request so a saved setting applies to the
  // next request without a restart. No settings service mounted keeps the
  // composition values.
  let source: () => RoleRouterSettings = () => ({})
  installSettingsSection(ctx, ROLE_ROUTER_SETTINGS_NAMESPACE, RoleRouterSettingsSchema, {
    default: composition.default,
    planner: composition.planner,
    subagent: composition.subagent,
  }, {
    setSource: current => { source = current },
    onChange: () => {},
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
   * Pure per-role route resolution: a configured role forces its model; an
   * unset role (and the explicit follow-official marker) is undefined, so the
   * request passes through untouched. Edge behavior (plan-entry snapshot and
   * plan-exit restore) lives in the request listener below.
   */
  const routeFor = (role: AgentRole): ModelRole | undefined => {
    const fromSettings = source()[role]
    // The explicit follow-official marker wins over the composition layer and
    // means "leave the request alone".
    if (fromSettings === FOLLOW_OFFICIAL) return undefined
    return fromSettings ?? composition[role]
  }

  /** One session's plan-edge routing state (process memory only). */
  interface SessionRoutingState {
    wasPlanActive: boolean
    /** Official route captured on the plan-entry edge; restored once on exit. */
    prePlanRoute?: ModelRole
  }
  const sessionRouting = new Map<string, SessionRoutingState>()
  const sessionKey = (agent: Agent): string => String(agent.session.id)

  /** Capture only the model route, never other request parameters. */
  const snapshotRoute = (resolved: LlmCallConfig): ModelRole => ({
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
  })

  /** Restore a captured route, dropping an inherited effort like switchRoute. */
  const restoreRoute = (resolved: LlmCallConfig, snap: ModelRole): LlmCallConfig => {
    const { reasoningEffort: _inherited, ...rest } = resolved
    return {
      ...rest,
      provider: snap.provider,
      model: snap.model,
      ...snap.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(snap.reasoningEffort) },
    }
  }

  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next()
    const active = planActive(ctx, agent)
    const origin = agent.session.header.origin

    // Subagents own a separate session and never take part in plan-edge
    // routing; their role is a plain configured/pass-through route.
    if (origin === 'subagent') {
      const sub = routeFor('subagent')
      return sub === undefined ? resolved : switchRoute(resolved, sub)
    }

    const key = sessionKey(agent)
    const state = sessionRouting.get(key)

    // Plan-entry edge: snapshot the official route only when the planner is
    // actually configured (an unconfigured planner never pollutes the header,
    // so restoring would clobber in-plan user picks). The snapshot happens
    // after next() so it captures the pre-planner official selection.
    if (active && (state === undefined || !state.wasPlanActive)) {
      const planner = routeFor('planner')
      if (planner !== undefined) {
        sessionRouting.set(key, { wasPlanActive: true, prePlanRoute: snapshotRoute(resolved) })
        return switchRoute(resolved, planner)
      }
      sessionRouting.set(key, { wasPlanActive: true })
      return resolved
    }

    // Plan mode continues: keep forcing the planner, never overwrite the snapshot.
    if (active) {
      const planner = routeFor('planner')
      return planner === undefined ? resolved : switchRoute(resolved, planner)
    }

    // Plan-exit edge: restore the pre-plan official route once for an unset
    // default, then clean up unconditionally (a fixed default role wins).
    if (state !== undefined && state.wasPlanActive) {
      const defaultTarget = routeFor('default')
      let result: LlmCallConfig
      if (defaultTarget === undefined && state.prePlanRoute !== undefined) {
        result = restoreRoute(resolved, state.prePlanRoute)
      } else if (defaultTarget !== undefined) {
        result = switchRoute(resolved, defaultTarget)
      } else {
        result = resolved
      }
      sessionRouting.delete(key)
      return result
    }

    // Ordinary default mode: pure pass-through or a fixed default route.
    const defaultTarget = routeFor('default')
    return defaultTarget === undefined ? resolved : switchRoute(resolved, defaultTarget)
  })

  // Keep the assembled `{{provider}}`/`{{model}}` persona variables in step
  // with the request route, mirroring installModelSelection's prompt/request
  // coupling (model-selection.ts). The plan-exit edge is read-only here (it
  // runs before agent/request), so the first post-plan turn assembles the
  // restored variables and then the request restores the config — never a
  // planner persona paired with a restored request. Pass-through requests
  // keep whatever the official selection assembled.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const active = planActive(ctx, agent)
    const origin = agent.session.header.origin
    let target: ModelRole | undefined
    if (origin === 'subagent') {
      target = routeFor('subagent')
    } else if (active) {
      target = routeFor('planner')
    } else {
      const defaultTarget = routeFor('default')
      if (defaultTarget !== undefined) {
        target = defaultTarget
      } else {
        const state = sessionRouting.get(sessionKey(agent))
        if (state !== undefined && state.wasPlanActive && state.prePlanRoute !== undefined) {
          target = state.prePlanRoute
        }
      }
    }
    if (target === undefined) return assembled
    return {
      ...assembled,
      variables: { ...assembled.variables, provider: target.provider, model: target.model },
    }
  })
}
