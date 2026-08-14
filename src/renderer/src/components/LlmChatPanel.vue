<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { AiFeatureId } from '../../../shared/types'
import { buildEffectiveSystemPrompt, FEATURE_NAMES } from '../../../shared/llmPrompts'
import { canvasToZodCode } from '../../../shared/schema'
import { useProjectStore } from '../stores/project'

const props = defineProps<{
  featureId: AiFeatureId
  /** 显示世界书条目选择器（世界书 / Schema / MVU世界书 界面） */
  showWorldbookSelect?: boolean
  /** 视图自带的"既有信息"（如当前状态栏 HTML / 创建卡片 HTML），勾选「既有信息」时附带 */
  existingInfo?: string
}>()
const emit = defineEmits<{
  (e: 'result', content: string): void
}>()

const project = useProjectStore()

// 单发模式：无对话历史；发送后自动把 AI 结果交给页面处理（@result）
const need = ref('')
const streaming = ref(false)
const streamText = ref('')
const error = ref('')
const lastResult = ref('')
const resultOpen = ref(false)

// ---------- 请求选项 ----------
const includeExisting = ref(false)

// ---------- 世界书条目选择（弹窗） ----------
const worldbookEntries = computed(() => project.project?.worldbookEntries ?? [])
const selectedEntryIds = ref<number[]>([])

const wbModalOpen = ref(false)
const wbQuery = ref('')
const wbFilterEnabled = ref<'all' | 'on' | 'off'>('all')
const wbFilterMode = ref<'all' | 'constant' | 'selective'>('all')
const wbTemp = ref<number[]>([])

/** 默认选中所有启用的世界书条目；换卡后重置 */
watch(
  () => project.project?.card.path,
  () => {
    selectedEntryIds.value = worldbookEntries.value.filter((e) => e.enabled).map((e) => e.id)
  },
  { immediate: true }
)

/** 按搜索词 + 状态/灯色条件筛选后的条目 */
const filteredWorldbook = computed(() => {
  const q = wbQuery.value.trim().toLowerCase()
  return worldbookEntries.value.filter((e) => {
    if (wbFilterEnabled.value === 'on' && !e.enabled) return false
    if (wbFilterEnabled.value === 'off' && e.enabled) return false
    if (wbFilterMode.value === 'constant' && !e.constant) return false
    if (wbFilterMode.value === 'selective' && !e.selective) return false
    if (q) {
      const hay = `${e.comment} ${e.keys.join(' ')} ${e.content}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

function openWbModal(): void {
  wbTemp.value = [...selectedEntryIds.value]
  wbQuery.value = ''
  wbFilterEnabled.value = 'all'
  wbFilterMode.value = 'all'
  wbModalOpen.value = true
}

function confirmWb(): void {
  selectedEntryIds.value = [...wbTemp.value]
  wbModalOpen.value = false
}

function cancelWb(): void {
  wbModalOpen.value = false
}

function toggleTemp(id: number): void {
  const idx = wbTemp.value.indexOf(id)
  if (idx >= 0) wbTemp.value.splice(idx, 1)
  else wbTemp.value.push(id)
}

/** 批量：勾选全部筛选结果 */
function batchFiltered(): void {
  wbTemp.value = filteredWorldbook.value.map((e) => e.id)
}

/** 批量：全不选 */
function batchNone(): void {
  wbTemp.value = []
}

/** 批量：反选筛选结果 */
function batchInvert(): void {
  const filtered = new Set(filteredWorldbook.value.map((e) => e.id))
  wbTemp.value = worldbookEntries.value
    .filter((e) =>
      filtered.has(e.id) ? !wbTemp.value.includes(e.id) : wbTemp.value.includes(e.id)
    )
    .map((e) => e.id)
}

/** 批量：勾选全部启用的条目 */
function batchEnabled(): void {
  for (const e of worldbookEntries.value) {
    if (e.enabled && !wbTemp.value.includes(e.id)) wbTemp.value.push(e.id)
  }
}

/** 批量：勾选全部蓝灯条目 */
function batchConstant(): void {
  for (const e of worldbookEntries.value) {
    if (e.constant && !wbTemp.value.includes(e.id)) wbTemp.value.push(e.id)
  }
}

/** 批量：勾选全部绿灯条目 */
function batchSelective(): void {
  for (const e of worldbookEntries.value) {
    if (e.selective && !wbTemp.value.includes(e.id)) wbTemp.value.push(e.id)
  }
}

// ---------- 提示词与上下文 ----------
function systemPrompt(): string {
  return buildEffectiveSystemPrompt(
    props.featureId,
    project.project?.schemaCanvas ?? null,
    project.config?.promptOverrides
  )
}

/** 既有信息：视图传入优先，否则按任务从项目中取 */
function buildExistingInfo(): string {
  if (props.existingInfo?.trim()) return `【既有信息】\n${props.existingInfo.trim()}`
  if (!project.project) return ''
  if (props.featureId === 'schema') {
    return `【当前 schema 代码】\n${canvasToZodCode(project.project.schemaCanvas)}`
  }
  if (props.featureId === 'updaterules') {
    return `【当前变量更新规则】\n${project.mvuDrafts.updateRules}\n\n【当前变量输出格式】\n${project.mvuDrafts.outputFormat}`
  }
  return ''
}

function userContext(): string {
  const card = project.project?.card.json.data
  const parts: string[] = [
    `角色卡: ${card?.name ?? '未命名'}\n描述: ${card?.description?.slice(0, 200) ?? ''}`
  ]
  if (includeExisting.value) {
    const existing = buildExistingInfo()
    if (existing) parts.push(existing)
  }
  if (props.showWorldbookSelect && selectedEntryIds.value.length > 0) {
    const selected = worldbookEntries.value.filter((e) => selectedEntryIds.value.includes(e.id))
    if (selected.length) {
      parts.push(
        `【参考世界书条目】\n${selected.map((e) => `### ${e.comment}\n${e.content}`).join('\n\n')}`
      )
    }
  }
  return parts.join('\n\n---\n\n')
}

async function send(): Promise<void> {
  const text = need.value.trim()
  if (!text || streaming.value) return
  need.value = ''
  streaming.value = true
  streamText.value = ''
  error.value = ''
  lastResult.value = ''
  resultOpen.value = false
  try {
    const result = await window.cardTool.llmStream(
      {
        featureId: props.featureId,
        // 单发模式：不携带任何历史对话
        messages: [],
        systemPrompt: systemPrompt(),
        userContext: userContext(),
        need: text
      },
      systemPrompt(),
      (delta) => {
        streamText.value += delta
      }
    )
    if (result.error) {
      error.value = result.error
    } else {
      lastResult.value = result.content
      // 自动应用：把 AI 结果交给当前页面处理（如 Schema 载入画布 / 世界书追加条目）
      emit('result', result.content)
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    streaming.value = false
    streamText.value = ''
  }
}
</script>

<template>
  <div class="llm-panel">
    <div class="llm-head">
      <span>🤖 {{ FEATURE_NAMES[featureId] }}（AI 辅助）</span>
    </div>

    <div class="llm-options">
      <label class="opt-check">
        <input v-model="includeExisting" type="checkbox" /> 既有信息
      </label>
      <div v-if="showWorldbookSelect" class="wb-select">
        <button class="wb-toggle" @click="openWbModal">
          📚 世界书条目（已选 {{ selectedEntryIds.length }}/{{ worldbookEntries.length }}）
        </button>
      </div>
    </div>

    <!-- 世界书条目选择弹窗 -->
    <div v-if="wbModalOpen" class="wb-modal-mask" @click.self="cancelWb">
      <div class="wb-modal">
        <div class="wb-modal-head">
          <h3>选择发送时附带的世界书条目</h3>
          <button class="mini" @click="cancelWb">✕</button>
        </div>

        <div class="wb-modal-toolbar">
          <input
            v-model="wbQuery"
            class="text-input wb-search"
            placeholder="🔍 搜索名称 / 关键词 / 内容..."
          />
          <select v-model="wbFilterEnabled" class="text-input wb-filter">
            <option value="all">状态：全部</option>
            <option value="on">状态：仅启用</option>
            <option value="off">状态：仅停用</option>
          </select>
          <select v-model="wbFilterMode" class="text-input wb-filter">
            <option value="all">灯色：全部</option>
            <option value="constant">灯色：仅蓝灯</option>
            <option value="selective">灯色：仅绿灯</option>
          </select>
        </div>

        <div class="wb-modal-batch">
          <span class="batch-label">批量：</span>
          <button class="mini" @click="batchFiltered">全选(筛选结果)</button>
          <button class="mini" @click="batchInvert">反选(筛选结果)</button>
          <button class="mini" @click="batchNone">全不选</button>
          <button class="mini" @click="batchEnabled">勾选全部启用</button>
          <button class="mini" @click="batchConstant">勾选全部蓝灯</button>
          <button class="mini" @click="batchSelective">勾选全部绿灯</button>
        </div>

        <div class="wb-modal-list">
          <label
            v-for="e in filteredWorldbook"
            :key="e.id"
            class="wb-item"
            :class="{ off: !e.enabled }"
          >
            <input type="checkbox" :checked="wbTemp.includes(e.id)" @change="toggleTemp(e.id)" />
            <span class="wb-name">{{ e.comment }}</span>
            <span class="badge" :class="e.constant ? 'badge-info' : 'badge-ok'">{{
              e.constant ? '蓝灯' : '绿灯'
            }}</span>
            <span class="badge" :class="e.enabled ? 'badge-ok' : 'badge-warn'">{{
              e.enabled ? '启用' : '停用'
            }}</span>
            <span class="wb-keys">{{ e.keys.slice(0, 3).join('、') }}</span>
          </label>
          <p v-if="filteredWorldbook.length === 0" class="wb-empty">无匹配条目</p>
        </div>

        <div class="wb-modal-foot">
          <span class="wb-count">已选 {{ wbTemp.length }} 条</span>
          <button class="btn-ghost" @click="cancelWb">取消</button>
          <button class="btn-primary" @click="confirmWb">确定（{{ wbTemp.length }}）</button>
        </div>
      </div>
    </div>

    <!-- 输入区（发送后样式不变，等待 AI 输出并自动应用） -->
    <div class="llm-input">
      <textarea
        v-model="need"
        class="msg-input"
        rows="2"
        placeholder="需求描述（任务由当前页面决定）...（Enter 发送，Shift+Enter 换行）"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button class="btn-primary" :disabled="streaming || !need.trim()" @click="send">
        {{ streaming ? '生成中...' : '发送' }}
      </button>
    </div>

    <div v-if="streaming" class="llm-status streaming">
      ⏳ AI 生成中...
      <pre class="stream-text">{{ streamText }}</pre>
    </div>
    <div v-if="error" class="llm-status error">❌ {{ error }}</div>
    <div v-if="!streaming && lastResult" class="llm-status done">
      ✅ 已生成并自动应用到当前页面
      <button class="mini" @click="resultOpen = !resultOpen">
        {{ resultOpen ? '收起' : '查看原文' }}
      </button>
      <pre v-if="resultOpen" class="stream-text">{{ lastResult }}</pre>
    </div>
  </div>
</template>

<style scoped>
.llm-panel {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 16px;
}
.llm-head {
  color: #ffc94d;
  font-weight: 700;
  margin-bottom: 8px;
  font-size: 13px;
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
.llm-options {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.opt-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #a9b3c3;
  font-size: 12px;
  cursor: pointer;
}
.wb-select {
  position: relative;
}
.wb-toggle {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #d4dbe6;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.wb-toggle:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
.wb-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wb-modal {
  width: 600px;
  max-width: 94vw;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: #131926;
  border: 1px solid #32415f;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.wb-modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #25304a;
}
.wb-modal-head h3 {
  color: #ffc94d;
  font-size: 14px;
  margin: 0;
}
.wb-modal-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #25304a;
  flex-wrap: wrap;
}
.wb-search {
  flex: 1;
  min-width: 200px;
}
.wb-filter {
  width: 130px;
}
.wb-modal-batch {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 16px;
  border-bottom: 1px solid #25304a;
  background: #0e1420;
}
.batch-label {
  color: #79869a;
  font-size: 12px;
}
.wb-modal-list {
  overflow-y: auto;
  padding: 8px 12px;
  flex: 1;
}
.wb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.wb-item:hover {
  background: #1c2434;
}
.wb-item.off {
  opacity: 0.55;
}
.wb-name {
  color: #e8ecf3;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-keys {
  color: #5d6a80;
  font-size: 11px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wb-empty {
  color: #5d6a80;
  font-size: 12px;
  text-align: center;
  padding: 12px;
}
.wb-modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid #25304a;
  background: #0e1420;
}
.wb-count {
  color: #a9b3c3;
  font-size: 12px;
  margin-right: auto;
}
.btn-ghost {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 6px 14px;
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
  padding: 6px 16px;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  font-size: 12px;
}
.text-input {
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}
.llm-input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.msg-input {
  flex: 1;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
  resize: vertical;
}
.llm-status {
  margin-top: 10px;
  font-size: 12px;
  border-radius: 6px;
  padding: 8px 10px;
}
.llm-status.streaming {
  color: #58a6ff;
  background: #0e1420;
  border: 1px solid #1e3350;
}
.llm-status.done {
  color: #3ddc84;
  background: #0f2f20;
  border: 1px solid #2a7a3a;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.llm-status.error {
  color: #ff5d5d;
  background: #3a1a1a;
  border: 1px solid #7a2a36;
}
.stream-text {
  width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: Consolas, monospace;
  font-size: 12px;
  color: #a9b3c3;
  margin: 6px 0 0;
  max-height: 200px;
  overflow-y: auto;
}
</style>
