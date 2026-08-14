// ============================================================
// IPC 契约：preload 暴露的 window.cardTool 方法签名
// ============================================================

import type {
  AiFeatureId,
  CardFormat,
  CardProject,
  CharCardV2,
  ExportResult,
  LlmMessage,
  Opening,
  RegexScript,
  SchemaCanvas,
  ToolConfig,
  ValidationReport,
  WorldInfoEntry
} from './types'

export interface OpenCardResult {
  path: string
  format: CardFormat
  json: CharCardV2
}

// 反推 schema 画布的产物（M1）
export interface SchemaReconstruction {
  canvas: SchemaCanvas | null // null = 反推失败（纯代码模式）
  schemaCode: string // 提取出的 zod 源码
  parseError?: string
}

export interface InitvarValidationResult {
  ok: boolean
  errors: { path: (string | number)[]; message: string }[]
}

export interface RegexTestResult {
  ok: boolean
  error?: string
  output?: string
}

export interface LlmChatRequest {
  featureId: AiFeatureId
  messages: LlmMessage[]
  systemPrompt: string
  userContext: string
  /** 统一需求描述（替代旧的 personalNeed） */
  need?: string
  /** 兼容旧字段 */
  personalNeed?: string
  model?: string // 覆盖全局模型
}

export interface LlmChatResult {
  content: string
  model: string
  error?: string
}

/** MVU 世界书页的三份草稿：导出时写入对应世界书条目（变量列表恒用程序默认值覆盖） */
export interface MvuWorldbookDrafts {
  updateRules?: string
  outputFormat?: string
  variableList?: string
}

export interface CardToolApi {
  openCard(): Promise<OpenCardResult | null>
  loadProject(): Promise<CardProject | null>
  /** 持久化当前工作项目（重启后恢复，避免丢失未导出的编辑） */
  saveSessionProject(project: CardProject): Promise<void>
  loadSessionProject(): Promise<CardProject | null>
  reconstructSchema(): Promise<SchemaReconstruction>
  schemaToCode(canvas: SchemaCanvas): Promise<string>
  validateInitvar(schemaCode: string, yaml: string): Promise<InitvarValidationResult>
  generateInitvarSkeleton(schemaCode: string): Promise<string>
  testRegex(findRegex: string, text: string): Promise<RegexTestResult>
  testRegexReplace(findRegex: string, replaceString: string, text: string): Promise<RegexTestResult>
  validateCard(project: CardProject): Promise<ValidationReport>
  exportCard(project: CardProject, format: CardFormat): Promise<ExportResult>
  exportCardWithDrafts(
    project: CardProject,
    format: CardFormat,
    drafts?: MvuWorldbookDrafts
  ): Promise<ExportResult>
  getBeautifyTemplates(): Promise<RegexScript[]>
  getConfig(): Promise<ToolConfig>
  saveConfig(config: ToolConfig): Promise<void>
  llmChat(request: LlmChatRequest, systemPrompt: string): Promise<LlmChatResult>
  llmStream(
    request: LlmChatRequest,
    systemPrompt: string,
    onChunk: (delta: string) => void
  ): Promise<LlmChatResult>
  /** 打开 LLM 请求日志文件，返回日志路径 */
  openLlmLog(): Promise<string>
}

// 供 renderer 用：卡类型辅助
export interface CardPayload {
  openings: Opening[]
  regexes: RegexScript[]
  worldbookEntries: WorldInfoEntry[]
  schemaCanvas: SchemaCanvas
}
