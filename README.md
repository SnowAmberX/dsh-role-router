中文 | [English](README.en.md)

# 多角色模型路由插件（dsh-role-router）

还在为计划与执行阶段手动切换模型而烦恼？`dsh-role-router` 替你自动完成：输入 `/plan` 进入计划模式，请求即自动路由到配置的 planner 模型；退出计划模式自动切回默认模型——全程无需手动干预。

- **角色路由**：`default` / `planner` / `subagent` 三种角色独立配置——**配置了强制使用该模型，未配置则跟随官方模型选择器**；`planner` 由计划模式（`/plan` 等）自动触发。
- **Web UI**：设置页「多角色模型路由」卡片提供三个模型下拉框（并可单独指定推理强度），选项与 `/model` 同源（host 实时模型目录，provider 分组，自动刷新）；composer 旁附模型摘要胶囊，当前选择一目了然。
- **两级配置**：支持 cordis.yml（composition 层）与 `role-router` settings 命名空间（用户层，后者优先）；保存即生效，无需重启。

## 预览

![主界面与 composer 模型摘要](img/main.png)

![设置页中的多角色模型路由卡片](img/setting.png)

## 路由语义

每次模型请求按角色路由，监听器注册在根上下文（同时覆盖主代理与所有进程内子代理）：

| 角色 | 请求范围 | 模型来源 |
|---|---|---|
| `default` | 默认模式下的主代理请求 | 已配置 → **强制使用**配置的模型；未配置 → **请求透传**，跟随官方逐层选择 |
| `planner` | 计划模式（plan mode）下的主代理请求 | 已配置 → **强制使用**配置的模型；未配置 → **请求透传**，跟随官方逐层选择 |
| `subagent` | 所有进程内子代理请求（任意嵌套深度） | 已配置 → **强制使用**配置的模型；未配置 → **请求透传**，跟随官方逐层选择 |

未配置角色的"跟随官方"是**完全透传**：插件不改动请求，由 harness 官方的每会话模型选择层按既有优先级决定——本次会话内显式切换（composer / `/model`）> 会话最近一次请求记录 > 全局默认模型（agent-default-model 设置）。因此会话内切换模型对未配置角色在**下一个 turn** 生效（官方选择层在请求装配时快照当前选择，turn 进行中的切换不改变进行中的 turn），composer 摘要与实际请求保持一致。

切换模型时，若角色未配置显式 `reasoningEffort`，则**剥离**继承的 adapter-owned effort（目标模型可能不支持原模型的推理档位；`prepareCall` 会拒绝未受支持的显式 effort）；配置了显式强度则写入并由 `prepareCall` 校验。透传的请求保留官方层装配的一切，包括推理强度。

计划模式状态从会话日志的 `plan/mode` 事件折叠（`foldPlanMode`）；`ctx.planMode` 可见时优先读取（含 pending 意图）。

辅助模型调用（compaction、session-title）不经 `agent/request` 派发，不受影响；进程外子代理 provider（acp、codex 等）的请求不经过本进程，同样不受影响。

## Web UI（client 半区）

插件声明了 `dsh.client`（platform: web），向 Web GUI 提供两处界面：

1. **设置 → 插件配置 →「多角色模型路由」卡片**：三个模型下拉框（默认模型 / planner / subagent），选项来自 host 实时模型目录（provider 分组，与 `/model` 同源，`llm/adapters-updated` 自动刷新）；每个字段选中模型后还可单独指定**推理强度**，档位来自该模型在目录中的 `reasoning.efforts`（适配器声明，非硬编码）。
   - 三个角色字段（默认模型 / planner / subagent）都写入 `role-router` 设置命名空间，保存后下一请求即生效（无需重启）；**未配置的角色跟随官方模型选择器**，配置了则强制使用所选模型。
2. **会话输入框旁（composer）**：胶囊摘要显示 `默认模型: <配置的 default 或当前会话选择> · planner: <配置的 planner 模型>`。官方模型席位（下拉选择）与 `/model` 命令保持原样。

## 配置

### cordis.yml（composition 层）

```yaml
- id: model-router
  name: '@snowamberx/dsh-role-router'
  config:
    default:        # 可选；不写键则保持未配置（透传）
      provider: deepseek-official
      model: deepseek-v4-flash
      reasoningEffort: high   # 可选；未配置时遵循目标模型默认
    planner:        # 可选
      provider: deepseek-official
      model: deepseek-v4-pro
      reasoningEffort: max    # 可选
    subagent:       # 可选
      provider: deepseek-official
      model: deepseek-v4-flash
```

未知键、空白 provider/model/reasoningEffort 在加载期直接报错（fail loud）。三个角色均为可选：未配置的角色请求透传，跟随官方逐层选择；配置了则强制使用。

### settings（用户层）

`role-router` 命名空间：`{ default?, planner?, subagent? }`，每个角色为 `{ provider, model, reasoningEffort? }`。设置文档值优先于 composition 层。

## 安装

```bash
dsh plugin --profile web add @snowamberx/dsh-role-router
# 本地开发：
dsh plugin --profile web add link:/path/to/this/repo
```

重启 `dsh web` 后生效（client-modules 的包元数据在重启时重新扫描）。

## 标准 DSH 社区插件包

本包是一个**标准 DSH 社区插件包（bundle）**：manifest 声明 `dsh.bundle` 配置层 + `dsh.client` web 半区，与官方 [打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.zh.md) 文档及 `packages/client/*` 各 client 插件包的约定一致。

- **`dsh.bundle` manifest**：`package.json` 中 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。`cordis.patch.yml` 是按行 id（`model-router`）插入插件行的 patch 层，插件按包名（`@snowamberx/dsh-role-router`）解析；`dsh plugin add` 识别该声明后会把包追加进 profile 的 `dsh.profile.bundles` 层栈（无 `dsh.bundle` 声明的包只会作为普通依赖安装并收到警告）。
- **web client 半区**：`"dsh": { "client": { "platform": "web", "inject": [...] } }` 声明浏览器半区；`exports["./client"]` 指向 `lib/client.js`，构建产物是标准闭包工厂（`window.__ModuleLoader__.load({ id, factory })`），由 client-modules 在 `/plugins/@snowamberx/dsh-role-router/client.js` 提供。`inject` 列出 client 半区依赖的包（信息性标注：preflight 展示与 HMR diffing；激活顺序由 cordis 服务注入决定）。
- **构建**：`tsc`（node 半区 + 类型声明）+ `tsdown`（`vendor/tsdown.client.ts`，与官方 `packages/client/tsdown.client.ts` 一致的 clientBundle 预设：CSS Modules 内联注入、平台模块走 externals、sourcemap 指向仓库源码路径）。

## 开发

```bash
pnpm install        # @deepseek-ai/* 运行时依赖由 harness checkout 软链提供（见下）
pnpm build          # tsc（host 半区 + 类型）+ tsdown（client bundle）
pnpm test           # vitest（host 路由集成测试 + 配置/分类单测）
```

`@deepseek-ai/*` 及 react/tsdown/lightningcss 等依赖通过 `node_modules` 软链指向 DeepSeek Harness checkout（与官方 profile 的 flat-fallback 机制一致），无需 npm 安装；tsconfig 开启 `preserveSymlinks` 使类型解析走同一平铺链。

## 已知限制

- 模型目录是 advisory（adapter 可接受未列出的模型 id），下拉框只列出目录内模型。
- composer 摘要仅显示 `default` + `planner` 两个角色（`subagent` 不在摘要范围）。
- 设置页无当前会话时，卡片下拉框显示"打开一个会话后可加载模型列表"（目录经当前会话的 `session.models` RPC 获取，groups 本身是全局的）。
- `planner`/`subagent` 配置的 provider 未注册 adapter 时，请求按 harness 常规路径报 NO_ADAPTER 轮次错误（响亮失败，不静默降级）。
- 强制路由会写入会话的请求头：官方"会话最近一次请求记录"层会把它当作会话当前模型。因此 `planner`/`subagent` 配置了强制模型、而 `default` 未配置时，一次计划模式请求后会话默认模型会沿用最近的 planner 模型（composer 摘要同步显示，可在输入框随时切回）。这与 harness 自身的每会话选择优先级一致。
