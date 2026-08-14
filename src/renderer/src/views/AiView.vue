<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import type { AiFeatureId, LlmConfig, LlmFeatureOverride } from '../../../shared/types'

const project = useProjectStore()
const config = ref<LlmConfig | null>(null)
const savedMsg = ref('')
const logPath = ref('')

async function openLog(): Promise<void> {
  try {
    logPath.value = await window.cardTool.openLlmLog()
  } catch (e) {
    savedMsg.value = (e as Error).message
  }
}

const featureOptions: { id: AiFeatureId; label: string }[] = [
  { id: 'schema', label: 'Schema' },
  { id: 'worldbook', label: '世界书' },
  { id: 'statusbar', label: '状态栏' },
  { id: 'createcard', label: '创建卡片' },
  { id: 'regexbeautify', label: '美化正则' },
  { id: 'updaterules', label: 'MVU世界书' },
  { id: 'opening', label: '开场白' }
]

const EFFORT_OPTIONS = ['', 'low', 'medium', 'high']

function cloneConfig(): LlmConfig | null {
  if (!project.config) return null
  return JSON.parse(JSON.stringify(project.config.llm)) as LlmConfig
}

onMounted(async () => {
  await project.loadConfig()
  config.value = cloneConfig()
})

function uid(): string {
  return 'p_' + Math.random().toString(16).slice(2, 10)
}

function addProvider(): void {
  if (!config.value) return
  config.value.providers.push({
    id: uid(),
    name: '新服务商',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  })
}

function removeProvider(id: string): void {
  if (!config.value) return
  if (config.value.providers.length <= 1) return
  config.value.providers = config.value.providers.filter((p) => p.id !== id)
  if (config.value.defaultProviderId === id) {
    config.value.defaultProviderId = config.value.providers[0].id
  }
  for (const ov of Object.values(config.value.perFeature)) {
    if (ov?.providerId === id) ov.providerId = undefined
  }
}

function featureOverride(featureId: AiFeatureId): LlmFeatureOverride {
  if (!config.value) return {}
  if (!config.value.perFeature[featureId]) config.value.perFeature[featureId] = {}
  return config.value.perFeature[featureId]!
}

async function save(): Promise<void> {
  if (!config.value || !project.config) return
  project.config.llm = config.value
  // 深拷贝为普通对象再发 IPC：Pinia 响应式 Proxy 无法被 structuredClone 克隆
  await window.cardTool.saveConfig(JSON.parse(JSON.stringify(project.config)))
  savedMsg.value = '已保存 AI 配置'
  setTimeout(() => (savedMsg.value = ''), 2000)
}
</script>

<template>
  <div class="page">
    <h2>AI 接入</h2>
    <p class="desc">
      按「服务商名」管理多个 OpenAI 兼容 LLM 配置，可切换默认服务商，并为不同任务单独配置 LLM（模型
      / max_tokens / 思考强度等）。
    </p>

    <div v-if="config" class="config-area">
      <div class="providers">
        <div v-for="p in config.providers" :key="p.id" class="provider-card">
          <div class="provider-head">
            <label class="radio-default">
              <input
                type="radio"
                name="default-provider"
                :checked="config.defaultProviderId === p.id"
                @change="config.defaultProviderId = p.id"
              />
              默认
            </label>
            <input v-model="p.name" class="text-input provider-name" placeholder="服务商名" />
            <button
              class="btn-x"
              :disabled="config.providers.length <= 1"
              @click="removeProvider(p.id)"
            >
              ✕
            </button>
          </div>

          <div class="field-grid">
            <div class="field">
              <label>Base URL</label>
              <input
                v-model="p.baseUrl"
                class="text-input"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div class="field">
              <label>API Key</label>
              <input v-model="p.apiKey" class="text-input" type="password" placeholder="sk-..." />
            </div>
            <div class="field">
              <label>模型</label>
              <input v-model="p.model" class="text-input" placeholder="gpt-4o-mini" />
            </div>
            <div class="field">
              <label>max_tokens</label>
              <input
                v-model.number="p.maxTokens"
                class="text-input"
                type="number"
                placeholder="(默认)"
              />
            </div>
            <div class="field">
              <label>思考强度 (reasoning_effort)</label>
              <select v-model="p.reasoningEffort" class="text-input">
                <option v-for="o in EFFORT_OPTIONS" :key="o" :value="o">
                  {{ o || '(默认)' }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>temperature</label>
              <input
                v-model.number="p.temperature"
                class="text-input"
                type="number"
                step="0.1"
                placeholder="0.7"
              />
            </div>
            <div class="field">
              <label>重试次数</label>
              <input v-model.number="p.maxRetries" class="text-input" type="number" />
            </div>
          </div>
        </div>
        <button class="btn-ghost" @click="addProvider">＋ 新增服务商</button>
      </div>

      <h3>按任务覆盖 LLM（留空则用默认服务商配置）</h3>
      <div class="per-feature-table">
        <div class="pf-row pf-head">
          <span>任务</span>
          <span>服务商</span>
          <span>模型</span>
          <span>max_tokens</span>
          <span>思考强度</span>
        </div>
        <div v-for="f in featureOptions" :key="f.id" class="pf-row">
          <span class="pf-name">{{ f.label }}</span>
          <select v-model="featureOverride(f.id).providerId" class="text-input">
            <option value="">(默认)</option>
            <option v-for="p in config.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <input v-model="featureOverride(f.id).model" class="text-input" placeholder="(默认)" />
          <input
            v-model.number="featureOverride(f.id).maxTokens"
            class="text-input"
            type="number"
            placeholder="(默认)"
          />
          <select v-model="featureOverride(f.id).reasoningEffort" class="text-input">
            <option v-for="o in EFFORT_OPTIONS" :key="o" :value="o">{{ o || '(默认)' }}</option>
          </select>
        </div>
      </div>

      <div class="log-bar">
        <button class="btn-ghost" @click="openLog">📄 打开 LLM 请求日志文件</button>
        <span v-if="logPath" class="log-path">{{ logPath }}</span>
        <span class="log-hint"
          >每次 AI 请求/响应都会完整写入该 JSONL 文件（含发送的 messages 原文）</span
        >
      </div>

      <button class="btn-primary" @click="save">保存配置</button>
      <span v-if="savedMsg" class="saved">{{ savedMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
h2 {
  color: #ffc94d;
  margin: 0 0 8px;
}
h3 {
  color: #d4dbe6;
  font-size: 14px;
  margin: 24px 0 8px;
}
.desc {
  color: #79869a;
  font-size: 13px;
  margin-bottom: 16px;
}
.providers {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.provider-card {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  padding: 14px 16px;
}
.provider-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.radio-default {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #a9b3c3;
  font-size: 12px;
  white-space: nowrap;
}
.provider-name {
  flex: 1;
  max-width: 240px;
  font-weight: 700;
}
.btn-x {
  background: transparent;
  border: none;
  color: #5d6a80;
  cursor: pointer;
  font-size: 14px;
}
.btn-x:hover:not(:disabled) {
  color: #ff5d5d;
}
.btn-x:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.field label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin-bottom: 4px;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
}
.btn-ghost {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  align-self: flex-start;
}
.btn-ghost:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
.per-feature-table {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 16px;
}
.pf-row {
  display: grid;
  grid-template-columns: 130px 1.2fr 1.4fr 0.9fr 1fr;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #1e2740;
}
.pf-row:last-child {
  border-bottom: none;
}
.pf-head {
  color: #79869a;
  font-size: 12px;
  background: #0e1420;
}
.pf-name {
  color: #a9b3c3;
  font-size: 13px;
}
.btn-primary {
  background: linear-gradient(135deg, #f5a623, #d98d1f);
  color: #0d1320;
  border: none;
  padding: 9px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 8px;
}
.saved {
  color: #3ddc84;
  margin-left: 12px;
  font-size: 13px;
}
.log-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 16px 0 8px;
  padding: 10px 12px;
  background: #0e1420;
  border: 1px solid #25304a;
  border-radius: 8px;
}
.btn-ghost {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.btn-ghost:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
.log-path {
  color: #58a6ff;
  font-size: 12px;
  word-break: break-all;
}
.log-hint {
  color: #5d6a80;
  font-size: 11px;
  width: 100%;
}
</style>
