# Role Router Plugin (dsh-role-router)

Tired of manually switching models between planning and execution?
`dsh-role-router` routes every DeepSeek Harness agent request by role:
planner model in plan mode, the default model otherwise, and a dedicated
model for subagents — no manual intervention needed.

- **Role routing**: `default`, `planner` and `subagent` are configured
  independently; an unconfigured role passes the request through untouched
  (the official layered selection applies). `planner` is triggered
  automatically by plan mode (`/plan` and friends).
- **Web UI**: a "Multi-role model routing" card on the settings page with
  three model pickers (each with an optional reasoning-effort level, same
  source as `/model` — the host's live, provider-grouped catalog), plus a
  composer summary pill.
- **Two configuration layers**: cordis.yml (composition) and the
  `role-router` settings namespace (user layer, which takes precedence);
  saved settings apply to the next request without a restart.

## Routing semantics

Every model request is routed by role; the listeners are registered on the
root context, so they observe top-level agents and every in-process subagent:

| Role | Requests | Model source |
|---|---|---|
| `default` | top-level agents outside plan mode | Configured → **forced**; unset → **pass-through** (official layered selection) |
| `planner` | top-level agents while plan mode is active | Configured → **forced**; unset → **pass-through** (official layered selection) |
| `subagent` | every in-process subagent request (any depth) | Configured → **forced**; unset → **pass-through** (official layered selection) |

An unset role leaves the request untouched, so the harness's official
per-session selection applies with its usual precedence — in-session
switches (composer / `/model`) > the session's latest logged request > the
global default. In-session model switches therefore take effect for unset
roles on the next turn (the selection is snapshotted at prompt assembly, so
a mid-turn switch never splits the running turn).

Switching models drops an inherited adapter-owned `reasoningEffort` unless
the role configures an explicit one (the routed model may not support the
previous model's effort; `prepareCall` rejects unsupported explicit efforts);
pass-through requests keep everything the official layer assembled,
including its effort. Plan mode is folded from the durable `plan/mode`
session events (`foldPlanMode`); `ctx.planMode` is consulted first when
visible. Auxiliary model calls (compaction, session-title) and out-of-process
subagent providers (acp, codex, …) are unaffected.

Known interplay: a forced planner route is persisted into the session's
request header, and the official "latest logged request" layer treats that
as the session's current model. To keep an unset default (follow-official)
from inheriting the planner model after plan mode ends, the plugin snapshots
the official route at the plan-entry edge and restores it once at the
plan-exit edge, then resumes pure pass-through; a fixed default role wins
over the restore, and an unconfigured planner never snapshots.

## Installation

```bash
dsh plugin --profile web add @snowamberx/dsh-role-router
```

Restart `dsh web` for the change to take effect.

## A standard DSH community plugin package

This package is a standard DSH community bundle: `package.json` declares the
`dsh.bundle` manifest (`"patch": "./cordis.patch.yml"` — the configuration
layer `dsh plugin add` recognizes and stacks into `dsh.profile.bundles`) and
a `dsh.client` web half (`platform: "web"` + `inject` dependency edges), with
`exports["./client"]` shipping the browser bundle at `lib/client.js` (a
standard `window.__ModuleLoader__.load({ id, factory })` closure-factory
artifact served by client-modules under `/plugins/`). The build runs `tsc`
(node half + types) and `tsdown` with the same clientBundle preset the
official `packages/client/*` packages use.

## Configuration

### cordis.yml (composition layer)

```yaml
- id: model-router
  name: '@snowamberx/dsh-role-router'
  config:
    default:        # optional; omit the key to keep it unset (pass-through)
      provider: deepseek-official
      model: deepseek-v4-flash
    planner:        # optional
      provider: deepseek-official
      model: deepseek-v4-pro
      reasoningEffort: max    # optional
    subagent:       # optional
      provider: deepseek-official
      model: deepseek-v4-flash
```

Unknown keys and blank provider/model/reasoningEffort values fail loud at
load. All three roles are optional; unconfigured roles pass requests through
to the official layered selection.

### settings (user layer)

`role-router` namespace: `{ default?, planner?, subagent? }`, each role being
`{ provider, model, reasoningEffort? }`. Settings-document values win over the
composition layer.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
