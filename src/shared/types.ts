// ============================================================
// 共享类型：Main / Preload / Renderer 三方契约
// ============================================================

// ---------- 角色卡（chara_card_v2） ----------

export interface WorldInfoEntry {
  keys: string[]
  secondary_keys: string[]
  comment: string
  content: string
  constant: boolean
  selective: boolean
  insertion_order: number
  enabled: boolean
  position: string
  extensions: {
    position: number
    depth: number
    role: number
    order: number
    probability?: number
    sticky?: unknown
    cooldown?: unknown
    delay?: unknown
    display_index?: number
    vectorized?: boolean
  }
  id: number
}

export interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings?: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  substituteRegex: number
  minDepth?: number | null
  maxDepth?: number | null
}

export interface HelperScriptButton {
  name: string
  visible: boolean
}

export interface HelperScript {
  type: 'script'
  /** 脚本名（酒馆助手 JS-Slash-Runner 要求脚本对象自带 name；与 Record key 一致） */
  name?: string
  content: string
  enabled: boolean
  id: string
  info: string
  button: { enabled: boolean; buttons: HelperScriptButton[] }
  data: Record<string, unknown>
}

export interface CharacterBook {
  name: string
  // chara_card_v2 spec：entries 必须是数组（SillyTavern convertCharacterBook 会 entries.forEach）
  entries: WorldInfoEntry[]
}

export interface Extensions {
  talkativeness?: string
  fav?: boolean
  depth_prompt?: { prompt: string; depth: number; role: string }
  regex_scripts?: RegexScript[]
  tavern_helper?: {
    // 酒馆助手(JS-Slash-Runner)读取端：新格式为数组（元素含 name 字段），旧格式为 Record
    scripts: Record<string, HelperScript> | HelperScript[]
    variables: Record<string, unknown>
  }
  [key: string]: unknown
}

export interface CharCardV2 {
  spec: 'chara_card_v2' | 'chara_card_v3'
  spec_version: string
  data: {
    name: string
    description: string
    character_version?: string
    personality?: string
    scenario?: string
    first_mes: string
    mes_example?: string
    creator_notes?: string
    tags?: string[]
    system_prompt?: string
    post_history_instructions?: string
    creator?: string
    alternate_greetings?: string[]
    character_book?: CharacterBook
    extensions?: Extensions
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type CardFormat = 'png' | 'json'

export interface LoadedCard {
  path: string
  format: CardFormat
  json: CharCardV2
}

// ---------- Schema 画布 ----------

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'record' | 'object' | 'union'

/**
 * 画布节点 = 一个字段（或根节点）。
 * 节点间通过 parentId 构成父子树：
 *   - object / record 类型字段是"容器"，可拥有子节点（record 的子节点即 value 结构）
 *   - 根节点（id=root）是所有顶层字段的父
 */
export interface SchemaNode {
  id: string
  name: string // 根固定 "Schema"
  type: FieldType | 'root'
  parentId: string | null // 父节点 id（object/record 容器 或 root）
  position: { x: number; y: number }
  // ---- 类型细节 ----
  numberConfig?: {
    clampMin?: number | null
    clampMax?: number | null
    int?: boolean
    prefault?: number
  }
  enumValues?: string[]
  enumPrefault?: string
  stringPrefault?: string
  booleanPrefault?: boolean
  describe?: string
  // ---- record 专属 ----
  /** 该节点是某 record 的 value 定义（标量 value 时存在；对象 value 则子节点即字段） */
  isRecordValue?: boolean
  /** record key 类型（默认 string） */
  recordKeyType?: 'string' | 'number'
  /** record key 的描述（如 "NPC名称"） */
  recordKeyDescribe?: string
}

export interface SchemaCanvas {
  nodes: SchemaNode[] // 含 root 与所有字段节点
}

export const ROOT_NODE_ID = 'root'

// ---------- 开场白 ----------

export type OpeningType = 'text' | 'createCard' | 'mixed'

export interface Opening {
  key: string // 'main' | 'alt-0' | 'alt-1' ...
  text: string
  type: OpeningType
  initvarOverride?: string
  /** 混合/创建卡片类型的角色创建 HTML（独立于全局创建卡片页，可逐条开场白不同） */
  createCardHtml?: string
  /** 该开场白专属角色创建正则的名字（不同开场白可用不同名字） */
  createCardRegexName?: string
  /** 该开场白角色创建正则的查找目标（用户写在开场白正文里，预览时用临时正则替换为卡片） */
  createCardFindTarget?: string
}

// ---------- AI 配置 ----------

export type AiFeatureId =
  'schema' | 'worldbook' | 'statusbar' | 'createcard' | 'regexbeautify' | 'updaterules' | 'opening'

/** 单个 LLM 服务商配置（OpenAI 兼容） */
export interface LlmProviderConfig {
  id: string
  /** 服务商名（如 DeepSeek / OpenAI / 自定义） */
  name: string
  baseUrl: string
  apiKey: string
  model: string
  maxTokens?: number
  /** 思考强度：low / medium / high（reasoning_effort） */
  reasoningEffort?: string
  temperature?: number
  maxRetries?: number
}

/** 某任务（功能点）对 LLM 的覆盖配置，留空字段回落到默认服务商 */
export interface LlmFeatureOverride {
  providerId?: string
  model?: string
  maxTokens?: number
  reasoningEffort?: string
  temperature?: number
}

export interface LlmConfig {
  /** 默认服务商 id */
  defaultProviderId: string
  providers: LlmProviderConfig[]
  /** 按任务覆盖 LLM 配置 */
  perFeature: Partial<Record<AiFeatureId, LlmFeatureOverride>>
}

/** 通用提示词中的一条消息：role 与顺序自由（可多个 system/assistant/user 交替） */
export interface LlmGlobalMessage {
  role: 'system' | 'assistant' | 'user'
  content: string
}

/** 通用提示词：消息积木列表，按用户排列顺序置于每次请求开头 */
export interface LlmGlobalPrompt {
  messages: LlmGlobalMessage[]
}

/** 一份完整的提示词集合（通用 + 各任务覆盖），可导出/导入/存为预设 */
export interface LlmPromptSet {
  globalPrompt: LlmGlobalPrompt
  promptOverrides: Partial<Record<AiFeatureId, string>>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ---------- 会话项目 ----------

export interface CardProject {
  card: LoadedCard
  schemaCanvas: SchemaCanvas
  openings: Opening[]
  regexes: RegexScript[]
  worldbookEntries: WorldInfoEntry[]
  scripts: Record<string, HelperScript>
  mvuDetected: boolean
}

// ---------- 校验 ----------

export interface CheckResult {
  name: string
  passed: boolean
  message?: string
  fixes?: string[] // 可一键修复的说明
}

export interface ValidationReport {
  checks: CheckResult[]
  ok: boolean
}

// ---------- 导出 ----------

export interface ExportResult {
  path: string
  format: CardFormat
  report: ValidationReport
}

// ---------- 工具配置（持久化） ----------

export interface ToolConfig {
  cardPath?: string
  llm: LlmConfig
  /** 通用提示词（每次请求开头） */
  globalPrompt: LlmGlobalPrompt
  /** 各任务提示词覆盖（留空用内置默认） */
  promptOverrides: Partial<Record<AiFeatureId, string>>
  /** 提示词预设：不同预设 = 不同的提示词 JSON 集合 */
  promptPresets: Record<string, LlmPromptSet>
  statusBarTheme: string
  customStatusBarHtml: string
  customCreateCardHtml: string
  openingTemplates: Record<string, string>
}
