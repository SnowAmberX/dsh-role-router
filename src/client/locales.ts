/**
 * Locale dictionaries for the role-router client surfaces.
 * The `Key` type derives from the Chinese dictionary (source of truth).
 */

/** Chinese copy; the key set is the namespace's contract. */
const zh = {
  'card.title': '多角色模型路由',
  'card.description': '配置 default / planner / subagent 角色强制使用的模型；未配置的角色跟随官方模型选择器。',
  'card.notExposed': '当前部署未暴露 role-router 设置命名空间，卡片不可编辑。',
  'card.notWritable': '当前连接不可写设置文档（memory 模式）。',
  'card.save': '保存',
  'card.discard': '放弃',
  'card.saving': '保存中…',
  'card.dirty': '有未保存的修改',
  'card.saveFailed': '保存失败',
  'card.reset': '重置',
  'field.default.label': '默认模型',
  'field.default.hint': '默认模式请求强制使用的模型；未配置时跟随官方模型选择器（composer / /model）。',
  'field.planner.label': 'planner',
  'field.planner.hint': '计划模式（plan mode）下主代理使用的模型；未配置时跟随官方选择器。',
  'field.subagent.label': 'subagent',
  'field.subagent.hint': '子代理请求使用的模型；未配置时跟随官方选择器。',
  'field.effort.label': '推理强度',
  'field.effort.unset': '未指定（跟随模型默认）',
  'field.unset': '未配置（跟随官方）',
  'field.unsetHint': '选择后该角色跟随官方模型选择器',
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
  'card.description': 'Configure the models forced for the default, planner, and subagent roles; unset roles follow the official model selector.',
  'card.notExposed': 'This deployment does not expose the role-router settings namespace; the card is read-only.',
  'card.notWritable': 'The current connection cannot write the settings document (memory mode).',
  'card.save': 'Save',
  'card.discard': 'Discard',
  'card.saving': 'Saving…',
  'card.dirty': 'Unsaved changes',
  'card.saveFailed': 'Save failed',
  'card.reset': 'Reset',
  'field.default.label': 'Default model',
  'field.default.hint': 'The model forced for default-mode requests; unset follows the official selector (composer / /model).',
  'field.planner.label': 'planner',
  'field.planner.hint': 'The model top-level agents use while plan mode is active; unset follows the official selector.',
  'field.subagent.label': 'subagent',
  'field.subagent.hint': 'The model subagent requests use; unset follows the official selector.',
  'field.effort.label': 'Reasoning effort',
  'field.effort.unset': 'Unset (follow model default)',
  'field.unset': 'Unset (follow the official selector)',
  'field.unsetHint': 'This role then follows the official model selector',
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
