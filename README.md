# @SnowAmberX/dsh-role-router

Role-based model routing for DeepSeek Harness: switch the model per agent role.

## Routing semantics

Every model request is routed by role; the listeners are registered on the
root context, so they observe top-level agents and every in-process subagent:

| Role | Requests | Model source |
|---|---|---|
| `default` | top-level agents outside plan mode | **The official session model selection** (composer model seat / `/model` / agent-default-model settings). Requests pass through untouched — whatever the official picker selects IS the default role |
| `planner` | top-level agents while plan mode is active | This plugin's configuration (`role-router` settings namespace, or the `planner` composition entry); unset passes through (follows the session default) |
| `subagent` | every in-process subagent request (any depth) | This plugin's configuration (`subagent` entry); unset passes through |

Switching models drops an inherited adapter-owned `reasoningEffort` (the
routed model may not support the previous model's effort; `prepareCall`
rejects unsupported explicit efforts). The `default` role never switches, so
its effort is preserved.

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
   `llm/adapters-updated`).
   - The `default` field edits the official `agent-default-model` settings
     section directly (field-level writes; `reasoningEffort` untouched) — the
     configured default IS the new-session default selection.
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
    default:        # required; only a fallback when no settings service is mounted
      provider: deepseek-official
      model: deepseek-v4-flash
    planner:        # optional
      provider: deepseek-official
      model: deepseek-v4-pro
    subagent:       # optional
      provider: deepseek-official
      model: deepseek-v4-flash
```

Unknown keys and blank provider/model values fail loud at load. `default` is
required for schema compatibility, but the live `default` role comes from the
official agent-default-model selection.

### settings (user layer)

`role-router` namespace: `{ planner?: { provider, model }, subagent?: { provider, model } }`.
Settings-document values win over the composition layer.

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
