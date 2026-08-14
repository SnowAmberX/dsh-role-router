/**
 * Locale dictionaries for the role-router client surfaces.
 * The `Key` type derives from the Chinese dictionary (source of truth).
 */

/** Chinese copy; the key set is the namespace's contract. */
const zh = {
  'card.title': '多角色模型路由',
  'card.description': '配置 planner / subagent 角色使用的模型；默认模型即会话选择（可在输入框或 /model 切换）。',
  'card.notExposed': '当前部署未暴露 role-router 设置命名空间，卡片不可编辑。',
  'card.notWritable': '当前连接不可写设置文档（memory 模式）。',
  'card.save': '保存',
  'card.discard': '放弃',
  'card.saving': '保存中…',
  'card.dirty': '有未保存的修改',
  'card.overridden': '已覆盖',
  'card.reset': '重置',
  'field.default.label': '默认模型',
  'field.default.hint': '新建会话的默认选择模型；会话内可在输入框模型选择器或 /model 切换。',
  'field.planner.label': 'planner',
  'field.planner.hint': '计划模式（plan mode）下主代理使用的模型；未配置时跟随会话默认。',
  'field.subagent.label': 'subagent',
  'field.subagent.hint': '子代理请求使用的模型；未配置时跟随会话默认。',
  'field.effort.label': '推理强度',
  'field.effort.unset': '未指定（跟随模型默认）',
  'field.empty': '未配置（跟随会话默认）',
  'field.selectAria': '选择模型',
  'directory.loading': '模型列表加载中…',
  'directory.error': '模型列表加载失败',
  'directory.retry': '重试',
  'directory.empty': '没有可用模型',
  'directory.noSession': '打开一个会话后可加载模型列表',
  'directory.groupFailed': '「{name}」目录加载失败',
  'summary.default': '默认模型',
  'summary.planner': 'planner',
  'summary.empty': '未配置',
} as const

/** English mirror; must match the zh key set exactly. */
const en: Record<keyof typeof zh, string> = {
  'card.title': 'Multi-role model routing',
  'card.description': 'Configure the models used by the planner and subagent roles; the default model is the session selection (switch it in the composer or via /model).',
  'card.notExposed': 'This deployment does not expose the role-router settings namespace; the card is read-only.',
  'card.notWritable': 'The current connection cannot write the settings document (memory mode).',
  'card.save': 'Save',
  'card.discard': 'Discard',
  'card.saving': 'Saving…',
  'card.dirty': 'Unsaved changes',
  'card.overridden': 'Overridden',
  'card.reset': 'Reset',
  'field.default.label': 'Default model',
  'field.default.hint': 'The default model for new sessions; switch it per session in the composer model selector or via /model.',
  'field.planner.label': 'planner',
  'field.planner.hint': 'The model top-level agents use while plan mode is active; unset follows the session default.',
  'field.subagent.label': 'subagent',
  'field.subagent.hint': 'The model subagent requests use; unset follows the session default.',
  'field.effort.label': 'Reasoning effort',
  'field.effort.unset': 'Unset (follow model default)',
  'field.empty': 'Unset (follows session default)',
  'field.selectAria': 'Select model',
  'directory.loading': 'Loading models…',
  'directory.error': 'Failed to load models',
  'directory.retry': 'Retry',
  'directory.empty': 'No models available',
  'directory.noSession': 'Open a session to load the model list',
  'directory.groupFailed': 'Catalog for "{name}" failed to load',
  'summary.default': 'Default model',
  'summary.planner': 'planner',
  'summary.empty': 'Unset',
}

export type RoleRouterKey = keyof typeof zh

/** The namespace's dictionary pair. */
export const dictionaries = { zh, en } as const
