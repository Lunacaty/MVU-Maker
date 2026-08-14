// M6 · LLM 网关：OpenAI 兼容客户端，流式输出
import OpenAI from 'openai'
import type { LlmChatRequest, LlmChatResult } from '../../shared/ipc'
import type { LlmProviderConfig, ToolConfig } from '../../shared/types'
import { logLlm } from './logger'

interface ResolvedRequest {
  provider: LlmProviderConfig
  model: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  temperature: number
  maxTokens?: number
  reasoningEffort?: string
}

export class LlmGateway {
  private resolveConfig: () => Promise<ToolConfig>

  constructor(resolveConfig: () => Promise<ToolConfig>) {
    this.resolveConfig = resolveConfig
  }

  private buildClient(baseUrl: string, apiKey: string): OpenAI {
    return new OpenAI({
      baseURL: baseUrl.replace(/\/+$/, ''),
      apiKey: apiKey || 'sk-no-key',
      dangerouslyAllowBrowser: false
    })
  }

  /** 解析最终服务商 + 任务覆盖 + 组装消息（通用提示词 → 任务提示词 → 需求描述） */
  private async buildRequest(req: LlmChatRequest, systemPrompt: string): Promise<ResolvedRequest> {
    const cfg = await this.resolveConfig()
    const llm = cfg.llm
    const feature = llm.perFeature?.[req.featureId] ?? {}
    const provider =
      llm.providers.find((p) => p.id === (feature.providerId || llm.defaultProviderId)) ??
      llm.providers[0]
    const model = req.model || feature.model || provider.model
    const temperature = feature.temperature ?? provider.temperature ?? 0.7
    const maxTokens = feature.maxTokens ?? provider.maxTokens
    const reasoningEffort = feature.reasoningEffort ?? provider.reasoningEffort

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    // 1. 通用提示词（每次请求开头）：消息积木列表，按用户排列顺序原样发送
    const gp = cfg.globalPrompt ?? { messages: [] }
    for (const m of gp.messages ?? []) {
      if (!m?.content?.trim()) continue
      messages.push({ role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content })
    }
    // 2. 任务专用提示词
    messages.push({ role: 'system', content: systemPrompt })
    // 3. 用户需求描述（统一）
    const need = (req.need ?? req.personalNeed ?? '').trim()
    if (need) messages.push({ role: 'user', content: need })
    // 卡片上下文（含选中的世界书条目 / 既有信息）
    if (req.userContext?.trim()) {
      messages.push({ role: 'user', content: req.userContext })
    }
    // 对话历史
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content })
    }
    return { provider, model, messages, temperature, maxTokens, reasoningEffort }
  }

  private toPayload(r: ResolvedRequest): OpenAI.Chat.ChatCompletionCreateParams {
    const payload: OpenAI.Chat.ChatCompletionCreateParams = {
      model: r.model,
      messages: r.messages,
      temperature: r.temperature
    }
    if (r.maxTokens) payload.max_tokens = r.maxTokens
    if (r.reasoningEffort) {
      ;(payload as unknown as Record<string, unknown>).reasoning_effort = r.reasoningEffort
    }
    return payload
  }

  async chat(req: LlmChatRequest, systemPrompt: string): Promise<LlmChatResult> {
    const resolved = await this.buildRequest(req, systemPrompt)
    const client = this.buildClient(resolved.provider.baseUrl, resolved.provider.apiKey)
    const payload = this.toPayload(resolved)
    const started = Date.now()
    await logLlm({
      type: 'request',
      stream: false,
      feature: req.featureId,
      provider: resolved.provider.name,
      model: payload.model,
      maxTokens: payload.max_tokens ?? null,
      reasoningEffort: (payload as unknown as Record<string, unknown>).reasoning_effort ?? null,
      messages: payload.messages
    })
    try {
      const res = await client.chat.completions.create(
        payload as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
      )
      const content = res.choices?.[0]?.message?.content ?? ''
      await logLlm({
        type: 'response',
        feature: req.featureId,
        model: payload.model,
        durationMs: Date.now() - started,
        content
      })
      return { content, model: payload.model }
    } catch (e) {
      await logLlm({
        type: 'error',
        feature: req.featureId,
        model: payload.model,
        durationMs: Date.now() - started,
        error: (e as Error).message
      })
      return { content: '', model: payload.model, error: (e as Error).message }
    }
  }

  async chatStream(
    req: LlmChatRequest,
    systemPrompt: string,
    onChunk: (delta: string) => void
  ): Promise<LlmChatResult> {
    const resolved = await this.buildRequest(req, systemPrompt)
    const client = this.buildClient(resolved.provider.baseUrl, resolved.provider.apiKey)
    const payload = this.toPayload(resolved)
    const started = Date.now()
    await logLlm({
      type: 'request',
      stream: true,
      feature: req.featureId,
      provider: resolved.provider.name,
      model: payload.model,
      maxTokens: payload.max_tokens ?? null,
      reasoningEffort: (payload as unknown as Record<string, unknown>).reasoning_effort ?? null,
      messages: payload.messages
    })
    try {
      const stream = await client.chat.completions.create({
        ...payload,
        stream: true
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming)
      let content = ''
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          content += delta
          onChunk(delta)
        }
      }
      await logLlm({
        type: 'response',
        feature: req.featureId,
        model: payload.model,
        durationMs: Date.now() - started,
        content
      })
      return { content, model: payload.model }
    } catch (e) {
      await logLlm({
        type: 'error',
        feature: req.featureId,
        model: payload.model,
        durationMs: Date.now() - started,
        error: (e as Error).message
      })
      return { content: '', model: payload.model, error: (e as Error).message }
    }
  }
}
