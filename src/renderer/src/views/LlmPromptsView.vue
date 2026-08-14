<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import type { AiFeatureId, LlmGlobalMessage, LlmPromptSet } from '../../../shared/types'
import { systemPromptTemplate, FEATURE_NAMES } from '../../../shared/llmPrompts'

const project = useProjectStore()
const savedMsg = ref('')

const featureOptions: { id: AiFeatureId; label: string }[] = [
  { id: 'schema', label: 'Schema 设计/优化' },
  { id: 'worldbook', label: '世界书' },
  { id: 'statusbar', label: '状态栏' },
  { id: 'createcard', label: '创建卡片' },
  { id: 'regexbeautify', label: '变量更新美化' },
  { id: 'updaterules', label: 'MVU世界书' },
  { id: 'opening', label: '开场白' }
]

const ROLE_OPTIONS: { value: LlmGlobalMessage['role']; label: string }[] = [
  { value: 'system', label: 'system' },
  { value: 'assistant', label: 'ai' },
  { value: 'user', label: 'user' }
]

// 通用提示词：消息积木列表，顺序/个数/身份自由
const globalMessages = ref<LlmGlobalMessage[]>([])
const promptDrafts = ref<Partial<Record<AiFeatureId, string>>>({})

// ---------- 导出 / 导入 ----------
const exportOpen = ref(false)
const exportJson = ref('')
const importOpen = ref(false)
const importJson = ref('')
const importMsg = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)

// ---------- 预设 ----------
const presetName = ref('')
const presets = ref<Record<string, LlmPromptSet>>({})
const presetMsg = ref('')

function newMessage(role: LlmGlobalMessage['role'] = 'system'): LlmGlobalMessage {
  return { role, content: '' }
}

function addMessage(): void {
  globalMessages.value.push(newMessage())
}

function removeMessage(i: number): void {
  globalMessages.value.splice(i, 1)
}

function moveMessage(i: number, dir: -1 | 1): void {
  const target = i + dir
  if (target < 0 || target >= globalMessages.value.length) return
  const tmp = globalMessages.value[i]
  globalMessages.value[i] = globalMessages.value[target]
  globalMessages.value[target] = tmp
}

function collectPromptSet(): LlmPromptSet {
  return {
    globalPrompt: {
      messages: globalMessages.value
        .map((m) => ({ role: m.role, content: m.content }))
        .filter((m) => m.content.trim())
    },
    promptOverrides: Object.fromEntries(
      featureOptions.map((f) => [f.id, promptDrafts.value[f.id] ?? ''])
    ) as Partial<Record<AiFeatureId, string>>
  }
}

function applyPromptSet(set: LlmPromptSet): void {
  globalMessages.value = (set.globalPrompt?.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content
  }))
  promptDrafts.value = {}
  for (const f of featureOptions) {
    promptDrafts.value[f.id] = set.promptOverrides?.[f.id] ?? systemPromptTemplate(f.id)
  }
}

function openExport(): void {
  exportJson.value = JSON.stringify(collectPromptSet(), null, 2)
  exportOpen.value = true
}

function downloadExport(): void {
  const blob = new Blob([exportJson.value], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `llm-prompts-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function copyExport(): Promise<void> {
  await navigator.clipboard.writeText(exportJson.value)
  savedMsg.value = '已复制 JSON'
}

function openImport(): void {
  importJson.value = ''
  importMsg.value = ''
  importOpen.value = true
}

/** 打开系统文件选择器，读取 .json 提示词文件到导入框 */
function onPickImportFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    importJson.value = String(reader.result ?? '')
    importMsg.value = '已载入文件，确认内容后点「应用导入」'
  }
  reader.onerror = () => {
    importMsg.value = '❌ 读取文件失败'
  }
  reader.readAsText(file)
}

function applyImport(): void {
  try {
    const parsed = JSON.parse(importJson.value) as LlmPromptSet
    if (!parsed || typeof parsed !== 'object') throw new Error('不是对象')
    applyPromptSet(parsed)
    importMsg.value = '✅ 导入成功，已应用到编辑区（记得点「保存提示词」）'
  } catch {
    importMsg.value = '❌ JSON 解析失败，请检查格式'
  }
}

async function savePreset(): Promise<void> {
  if (!project.config) return
  const name = presetName.value.trim()
  if (!name) {
    presetMsg.value = '请先输入预设名'
    return
  }
  project.config.promptPresets[name] = collectPromptSet()
  presets.value = { ...project.config.promptPresets }
  presetMsg.value = `已保存预设「${name}」`
  // 深拷贝为普通对象再发 IPC：Pinia 响应式 Proxy 无法被 structuredClone 克隆
  await window.cardTool.saveConfig(JSON.parse(JSON.stringify(project.config)))
  setTimeout(() => (presetMsg.value = ''), 2000)
}

function loadPreset(name: string): void {
  const set = presets.value[name]
  if (!set) return
  applyPromptSet(set)
  presetMsg.value = `已载入预设「${name}」（记得点「保存提示词」）`
  setTimeout(() => (presetMsg.value = ''), 2000)
}

async function deletePreset(name: string): Promise<void> {
  if (!project.config) return
  delete project.config.promptPresets[name]
  presets.value = { ...project.config.promptPresets }
  await window.cardTool.saveConfig(JSON.parse(JSON.stringify(project.config)))
}

onMounted(async () => {
  await project.loadConfig()
  if (!project.config) return
  globalMessages.value = (project.config.globalPrompt?.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content
  }))
  promptDrafts.value = {}
  for (const f of featureOptions) {
    promptDrafts.value[f.id] = project.config.promptOverrides?.[f.id] ?? systemPromptTemplate(f.id)
  }
  presets.value = { ...(project.config.promptPresets ?? {}) }
})

function draft(featureId: AiFeatureId): string {
  return promptDrafts.value[featureId] ?? ''
}

function isOverridden(featureId: AiFeatureId): boolean {
  return Boolean(project.config?.promptOverrides?.[featureId])
}

function resetPrompt(featureId: AiFeatureId): void {
  if (!project.config) return
  delete project.config.promptOverrides[featureId]
  promptDrafts.value[featureId] = systemPromptTemplate(featureId)
}

async function save(): Promise<void> {
  if (!project.config) return
  project.config.globalPrompt = {
    messages: globalMessages.value
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((m) => m.content.trim())
  }
  for (const f of featureOptions) {
    project.config.promptOverrides[f.id] = promptDrafts.value[f.id] ?? ''
  }
  // 深拷贝为普通对象再发 IPC：Pinia 响应式 Proxy 无法被 structuredClone 克隆
  await window.cardTool.saveConfig(JSON.parse(JSON.stringify(project.config)))
  savedMsg.value = '已保存提示词'
  setTimeout(() => (savedMsg.value = ''), 2000)
}
</script>

<template>
  <div class="page">
    <h2>LLM 提示词</h2>
    <p class="desc">
      管理各任务（功能点）的提示词，并设置「通用提示词」。请求消息顺序：通用提示词（消息积木）→
      任务专用提示词 → 需求描述。
    </p>

    <div class="toolbar">
      <button class="btn-ghost" @click="openExport">⬇ 导出全部提示词为 JSON</button>
      <button class="btn-ghost" @click="openImport">⬆ 从 JSON 导入提示词</button>
    </div>

    <div class="panel preset-panel">
      <h3>📚 预设</h3>
      <p class="hint">不同的提示词 JSON 集合就是不同的预设，可保存多个、随时载入。</p>
      <div class="preset-save">
        <input
          v-model="presetName"
          class="text-input preset-input"
          placeholder="预设名，如：Kokoishi 默认 / 无限制版"
        />
        <button class="btn-ghost" @click="savePreset">＋ 保存为预设</button>
        <span v-if="presetMsg" class="preset-msg">{{ presetMsg }}</span>
      </div>
      <div class="preset-list">
        <div v-for="(set, name) in presets" :key="name" class="preset-item">
          <span class="preset-name">{{ name }}</span>
          <span class="preset-meta"
            >{{ (set.globalPrompt?.messages ?? []).length }} 条通用 ·
            {{
              Object.keys(set.promptOverrides ?? {}).filter(
                (k) => set.promptOverrides![k as AiFeatureId]
              ).length
            }}
            项任务覆盖</span
          >
          <span class="preset-btns">
            <button class="mini" @click="loadPreset(name)">载入</button>
            <button class="mini danger" @click="deletePreset(name)">删除</button>
          </span>
        </div>
        <p v-if="Object.keys(presets).length === 0" class="empty-hint">（暂无预设）</p>
      </div>
    </div>

    <div class="panel global-panel">
      <h3>🌐 通用提示词（每次请求开头，消息积木）</h3>
      <p class="hint">
        像搭积木一样自由构建：身份（system/ai/user）与顺序、条数均可随意增减排列，原样按顺序置于每次请求开头。
      </p>
      <div v-for="(m, i) in globalMessages" :key="i" class="gmsg">
        <div class="gmsg-head">
          <select v-model="m.role" class="text-input role-select">
            <option v-for="o in ROLE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <span class="gmsg-idx">#{{ i + 1 }}</span>
          <span class="gmsg-btns">
            <button class="mini" :disabled="i === 0" @click="moveMessage(i, -1)">↑</button>
            <button
              class="mini"
              :disabled="i === globalMessages.length - 1"
              @click="moveMessage(i, 1)"
            >
              ↓
            </button>
            <button class="mini danger" @click="removeMessage(i)">✕</button>
          </span>
        </div>
        <textarea
          v-model="m.content"
          class="text-area mono"
          rows="3"
          spellcheck="false"
          placeholder="消息内容..."
        ></textarea>
      </div>
      <button class="btn-ghost" @click="addMessage">＋ 添加消息</button>
      <p v-if="globalMessages.length === 0" class="empty-hint">（空）无通用提示词消息。</p>
    </div>

    <h3>任务专用提示词</h3>
    <p class="hint">
      默认提示词内置领域知识，schema 段以
      <code>&#123;&#123;schema&#125;&#125;</code> 占位（请求时替换为当前 schema）。
      可直接改写覆盖；「恢复默认」还原内置提示词。
    </p>

    <div v-for="f in featureOptions" :key="f.id" class="panel prompt-panel">
      <div class="prompt-head">
        <h3>{{ FEATURE_NAMES[f.id] }}</h3>
        <span v-if="isOverridden(f.id)" class="badge badge-warn">已覆盖</span>
        <button class="btn-ghost" @click="resetPrompt(f.id)">恢复默认</button>
      </div>
      <textarea
        :value="draft(f.id)"
        class="text-area mono"
        rows="8"
        spellcheck="false"
        @input="promptDrafts[f.id] = ($event.target as HTMLTextAreaElement).value"
      ></textarea>
    </div>

    <button class="btn-primary" @click="save">保存提示词</button>
    <span v-if="savedMsg" class="saved">{{ savedMsg }}</span>

    <!-- 导出 JSON -->
    <div v-if="exportOpen" class="modal-mask" @click.self="exportOpen = false">
      <div class="modal">
        <div class="modal-head">
          <h3>导出提示词 JSON</h3>
          <button class="mini" @click="exportOpen = false">✕</button>
        </div>
        <textarea
          v-model="exportJson"
          class="text-area mono"
          rows="14"
          spellcheck="false"
        ></textarea>
        <div class="modal-actions">
          <button class="btn-ghost" @click="downloadExport">⬇ 下载 .json 文件</button>
          <button class="btn-ghost" @click="copyExport">复制</button>
        </div>
      </div>
    </div>

    <!-- 导入 JSON -->
    <div v-if="importOpen" class="modal-mask" @click.self="importOpen = false">
      <div class="modal">
        <div class="modal-head">
          <h3>从 JSON 导入提示词</h3>
          <button class="mini" @click="importOpen = false">✕</button>
        </div>
        <div class="modal-actions import-pick">
          <button class="btn-ghost" @click="importFileInput?.click()">📂 选择文件...</button>
          <span class="pick-hint">或直接粘贴 JSON 到下方</span>
          <input
            ref="importFileInput"
            type="file"
            accept=".json,application/json"
            style="display: none"
            @change="onPickImportFile"
          />
        </div>
        <textarea
          v-model="importJson"
          class="text-area mono"
          rows="10"
          spellcheck="false"
          placeholder='{"globalPrompt": {"messages": [...]}, "promptOverrides": {...}}'
        ></textarea>
        <p class="import-msg">{{ importMsg }}</p>
        <div class="modal-actions">
          <button class="btn-ghost" @click="applyImport">应用导入</button>
        </div>
      </div>
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
  font-size: 13px;
  margin: 0;
}
.desc {
  color: #79869a;
  font-size: 13px;
  margin-bottom: 16px;
}
.hint {
  color: #79869a;
  font-size: 12px;
  margin: 4px 0 8px;
}
code {
  color: #ffc94d;
}
.panel {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.field-label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin: 10px 0 4px;
}
.text-area {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 8px;
  padding: 10px;
  resize: vertical;
  line-height: 1.5;
}
.mono {
  font-family: Consolas, monospace;
  font-size: 12px;
}
.prompt-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.prompt-head h3 {
  flex: 1;
}
.gmsg {
  background: #0e1420;
  border: 1px solid #25304a;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
}
.gmsg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.role-select {
  width: 130px;
}
.gmsg-idx {
  color: #5d6a80;
  font-size: 12px;
}
.gmsg-btns {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.mini {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #a9b3c3;
  border-radius: 5px;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.mini:hover:not(:disabled) {
  border-color: #f5a623;
  color: #ffc94d;
}
.mini:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.mini.danger:hover:not(:disabled) {
  border-color: #ff5d5d;
  color: #ff5d5d;
}
.empty-hint {
  color: #5d6a80;
  font-size: 12px;
  margin-top: 8px;
}
.btn-ghost {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.btn-ghost:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
.btn-primary {
  background: linear-gradient(135deg, #f5a623, #d98d1f);
  color: #0d1320;
  border: none;
  padding: 9px 20px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}
.saved {
  color: #3ddc84;
  margin-left: 12px;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.preset-panel {
  margin-bottom: 14px;
}
.preset-save {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.preset-input {
  max-width: 320px;
}
.preset-msg,
.import-msg {
  color: #3ddc84;
  font-size: 12px;
  margin: 0;
}
.preset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #0e1420;
  border: 1px solid #25304a;
  border-radius: 6px;
  padding: 6px 10px;
}
.preset-name {
  color: #e8ecf3;
  font-weight: 600;
  min-width: 140px;
}
.preset-meta {
  color: #5d6a80;
  font-size: 11px;
  flex: 1;
}
.preset-btns {
  display: flex;
  gap: 4px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  width: 640px;
  max-width: 92vw;
  background: #131926;
  border: 1px solid #32415f;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.modal-head h3 {
  color: #ffc94d;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.import-pick {
  margin-top: 0;
  margin-bottom: 10px;
  align-items: center;
}
.pick-hint {
  color: #5d6a80;
  font-size: 12px;
}
</style>
