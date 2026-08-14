# Role Router Plugin (dsh-role-router)

Tired of manually switching models between planning and execution?
`dsh-role-router` routes every DeepSeek Harness agent request by role:
planner model in plan mode, the default model otherwise, and a dedicated
model for subagents — no manual intervention needed.

- **Role routing**: `default`, `planner` and `subagent` are configured
  independently; an unconfigured role follows the official model selector.
  `planner` is triggered automatically by plan mode (`/plan` and friends).
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
| `default` | top-level agents outside plan mode | Configured → **forced**; unset → official selector |
| `planner` | top-level agents while plan mode is active | Configured → **forced**; unset → official selector |
| `subagent` | every in-process subagent request (any depth) | Configured → **forced**; unset → official selector |

Switching models drops an inherited adapter-owned `reasoningEffort` unless
the role configures an explicit one (the routed model may not support the
previous model's effort; `prepareCall` rejects unsupported explicit efforts).
Plan mode is folded from the durable `plan/mode` session events
(`foldPlanMode`); `ctx.planMode` is consulted first when visible.
Auxiliary model calls (compaction, session-title) and out-of-process
subagent providers (acp, codex, …) are unaffected.

## Installation

```bash
dsh plugin --profile web add @snowamberx/dsh-role-router
```

Restart `dsh web` for the change to take effect.

## Configuration

### cordis.yml (composition layer)

```yaml
- id: model-router
  name: '@snowamberx/dsh-role-router'
  config:
    default:        # optional; unset follows the official selector
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
load. All three roles are optional; unconfigured roles follow the official
model selector.

### settings (user layer)

`role-router` namespace: `{ default?, planner?, subagent? }`, each role being
`{ provider, model, reasoningEffort? }`. Settings-document values win over the
composition layer.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
