English | [中文](README.md)

# Role Router Plugin (dsh-role-router)

Tired of manually switching models between planning and execution?
`dsh-role-router` does it for you: type `/plan` and requests are routed
automatically to the configured planner model; leaving plan mode switches
back to the default model — no manual intervention needed.

- **Role routing**: `default`, `planner` and `subagent` are configured
  independently; unconfigured roles pass through (follow the session
  default). `planner` is triggered automatically by plan mode (`/plan` and
  friends); `default` always tracks the official session model selection.
- **Web UI**: a "Multi-role model routing" card on the settings page with
  three model pickers (each with an optional reasoning-effort picker; same
  source as `/model` — the host's live, provider-grouped catalog,
  auto-refreshed), plus a composer-adjacent pill that shows the current
  selection at a glance.
- **Two configuration layers**: cordis.yml (composition) and the
  `role-router` settings namespace (user layer, which takes precedence);
  saved settings apply to the next request without a restart.

## Screenshots

![Main UI with the composer model summary](img/main.png)

![Multi-role model routing card on the settings page](img/setting.png)

## Routing semantics

Every model request is routed by role; the listeners are registered on the
root context, so they observe top-level agents and every in-process subagent:

| Role | Requests | Model source |
|---|---|---|
| `default` | top-level agents outside plan mode | Configured → **forced** to that model; unset → follows the official selector (composer / `/model` / agent-default-model) |
| `planner` | top-level agents while plan mode is active | Configured → **forced** to that model; unset → follows the official selector |
| `subagent` | every in-process subagent request (any depth) | Configured → **forced** to that model; unset → follows the official selector |

Switching models drops an inherited adapter-owned `reasoningEffort` unless
the role configures an explicit one (the routed model may not support the
previous model's effort; `prepareCall` rejects unsupported explicit efforts);
an explicit effort is applied and validated by `prepareCall`. The `default`
role never rewrites the request, so its effort always comes from the official
session selection (settable through the default field's effort picker).

Plan mode is folded from the durable `plan/mode` session events
(`foldPlanMode`); `ctx.planMode` is consulted first when visible
(pending-aware).

Auxiliary model calls (compaction, session-title) do not dispatch through
`agent/request` and are unaffected, as are out-of-process subagent providers
(acp, codex, …).

## Web UI (client half)

The package declares `dsh.client` (platform: web) and provides two surfaces:

1. **Settings → plugin configuration → "Multi-role model routing" card**: three
   model pickers (default / planner / subagent) fed by the host's live model
   catalog (provider-grouped, same source as `/model`, refreshed on
   `llm/adapters-updated`); after picking a model each field offers an optional
   **reasoning-effort** picker whose levels come from that model's
   `reasoning.efforts` in the catalog (adapter-declared, not hard-coded).
   - The `default` field edits the official `agent-default-model` settings
     section directly (field-level writes; without an explicit effort the
     official one is preserved, with one it is written) — the configured
     default IS the new-session default selection.
   - `planner` / `subagent` write the `role-router` settings namespace; a
     saved setting applies to the next request without a restart.
2. **Composer-adjacent summary**: a pill showing
   `Default model: <current session selection> · planner: <configured>`.
   The official model seat and `/model` stay untouched.

## Configuration

### cordis.yml (composition layer)

```yaml
- id: model-router
  name: '@SnowAmberX/dsh-role-router'
  config:
    default:        # optional; unset follows the official selector
      provider: deepseek-official
      model: deepseek-v4-flash
      reasoningEffort: high   # optional; unset follows the target model default
    planner:        # optional
      provider: deepseek-official
      model: deepseek-v4-pro
      reasoningEffort: max    # optional
    subagent:       # optional
      provider: deepseek-official
      model: deepseek-v4-flash
```

Unknown keys and blank provider/model/reasoningEffort values fail loud at
load. `default` is required for schema compatibility, but the live `default`
role comes from the official agent-default-model selection (into which the
plugin can write the default field's explicit effort).

### settings (user layer)

`role-router` namespace: `{ default?, planner?, subagent? }`, each role being
`{ provider, model, reasoningEffort? }`. Settings-document values win over the
composition layer.

## Install

```bash
dsh plugin --profile web add @SnowAmberX/dsh-role-router
# local development:
dsh plugin --profile web add link:/path/to/this/repo
```

Restart `dsh web` (client-modules rescans package metadata at boot).

## Development

```bash
pnpm install        # @deepseek-ai/* runtime deps are symlinked from the harness checkout (see below)
pnpm build          # tsc (host half + types) + tsdown (client bundle)
pnpm test           # vitest (host routing integration + config/classify units)
```

`@deepseek-ai/*`, react, tsdown and lightningcss are provided through
`node_modules` symlinks into the DeepSeek Harness checkout (the same
flat-fallback mechanism official profiles use) — no npm installs. tsconfig
enables `preserveSymlinks` so type resolution rides the same flat chain.

## Known limitations

- The catalog is advisory (adapters may accept unlisted model ids); the
  pickers only list catalog models.
- The composer summary shows `default` + `planner` only (not `subagent`).
- With no current session the card pickers defer loading ("open a session to
  load the model list"); the catalog is fetched through the current session's
  `session.models` RPC (the groups are global).
- A `planner`/`subagent` provider without a registered adapter fails the
  request with the normal NO_ADAPTER turn error (loud, no silent fallback).
