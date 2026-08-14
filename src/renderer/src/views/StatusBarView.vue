<script setup lang="ts">
/* eslint-disable no-useless-escape */
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import SandboxIframe from '../components/SandboxIframe.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import { makeStatusBarPair } from '../../../shared/templates'
import { PLACEHOLDER_STATUS } from '../../../shared/templates'
import { walkFields } from '../../../shared/schema'
import { matchRegexByTarget, extractHtmlFromReplace } from '../../../shared/regex'

const project = useProjectStore()

function getDeep(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}
function setDeep(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: unknown = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return
    const next = (cur as Record<string, unknown>)[parts[i]]
    if (next == null || typeof next !== 'object') (cur as Record<string, unknown>)[parts[i]] = {}
    cur = (cur as Record<string, unknown>)[parts[i]]
  }
  if (cur && typeof cur === 'object')
    (cur as Record<string, unknown>)[parts[parts.length - 1]] = value
}

// mock 变量（从 schema 生成骨架）
const mockData = ref<Record<string, unknown>>({})

const schemaFields = computed(() => {
  if (!project.project) return []
  return walkFields(project.project.schemaCanvas)
})

function buildMockFromSchema(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!project.project) return out
  for (const { path, node } of schemaFields.value) {
    const parts = path.split('.')
    let cur = out
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
      cur = cur[parts[i]] as Record<string, unknown>
    }
    const key = parts[parts.length - 1]
    switch (node.type) {
      case 'number':
        cur[key] = node.numberConfig?.prefault ?? 42
        break
      case 'boolean':
        cur[key] = node.booleanPrefault ?? true
        break
      case 'enum':
        cur[key] = node.enumValues?.[0] ?? '示例值'
        break
      case 'object':
      case 'record':
        cur[key] = {}
        break
      default:
        cur[key] = node.stringPrefault ?? '示例值'
    }
  }
  return out
}

watch(
  () => project.project?.schemaCanvas,
  () => {
    mockData.value = buildMockFromSchema()
  },
  { deep: true, immediate: true }
)

// 状态栏 HTML 编辑底稿（本地，非导出专用）
const statusBarHtml = ref('')

/** 默认模板：黑底白字，读取并展示 stat_data mock，保证沙盒打开即有内容 */
function defaultStatusBarTemplate(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
body { margin: 0; background: #000; color: #fff; font-family: "Microsoft YaHei", sans-serif; }
.stat-panel { border: 1px solid #333; border-radius: 8px; padding: 10px; background: #0a0a0a; font-size: 13px; }
.stat-title { color: #ffc94d; font-weight: 700; margin-bottom: 6px; }
.row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #1e1e1e; transition: background 0.2s; }
.row:last-child { border-bottom: none; }
.row:hover { background: #141414; }
.label { color: #888; }
.value { color: #fff; font-weight: 600; }
</style>
</head>
<body>
<div id="status-bar" class="stat-panel"><div class="stat-title">状态栏</div><div class="row"><span class="label">加载中...</span></div></div>
<script type="module">
const el = document.getElementById('status-bar');
function safe(fn) { try { fn(); } catch (e) { console.error(e); } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function render() {
  const stat = getVariables({ type: 'message', message_id: getCurrentMessageId() }).stat_data || {};
  const rows = Object.entries(stat).map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return '';
    return '<div class="row"><span class="label">' + esc(k) + '</span><span class="value">' + esc(v) + '</span></div>';
  }).join('');
  el.innerHTML = '<div class="stat-title">状态栏</div>' + rows;
}
function init() { safe(render); setInterval(safe, 2000, render); eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => safe(render)); }
$(errorCatched(init));
<\/script>
</body>
</html>`
}

// 从卡中自动匹配到的既有正则（按替换目标，非名称）
const matchedReplace = ref<string>('') // 显示"已匹配到 xxx"
// 指认下拉：列出所有非禁用正则（新增的正则立即可见，不再限定 markdownOnly）
const candidateRegexes = computed(() => (project.project?.regexes ?? []).filter((r) => !r.disabled))
const manualPick = ref<string>('') // 手动指认的正则 id

/** 导入卡后：按替换目标匹配既有状态栏正则，作为编辑底稿；无匹配时用默认模板 */
function loadFromCard(): void {
  if (!project.project) return
  const matched = matchRegexByTarget(project.project.regexes, PLACEHOLDER_STATUS)
  if (matched.replace) {
    matchedReplace.value = matched.replace.scriptName
    statusBarHtml.value =
      extractHtmlFromReplace(matched.replace.replaceString) || statusBarHtml.value
    project.statusBarMatched = true
  } else {
    matchedReplace.value = ''
  }
  if (!statusBarHtml.value.trim()) statusBarHtml.value = defaultStatusBarTemplate()
}

/** 手动指认一条正则作为底稿 */
function applyManualPick(): void {
  if (!project.project || !manualPick.value) return
  const r = project.project.regexes.find((x) => x.id === manualPick.value)
  if (r && r.replaceString) statusBarHtml.value = extractHtmlFromReplace(r.replaceString)
  matchedReplace.value = r ? r.scriptName : ''
  if (r) project.statusBarMatched = true
}

function injectToCard(): void {
  if (!project.project || !statusBarHtml.value.trim()) return
  const list = project.project.regexes
  for (const fresh of makeStatusBarPair(statusBarHtml.value)) {
    // 优先替换匹配到的既有正则（保名），否则按名称 upsert
    const existing = list.find(
      (r) => r.id === (fresh.scriptName === '状态栏界面' ? manualPick.value : '')
    )
    const idx = existing
      ? list.indexOf(existing)
      : list.findIndex((r) => r.scriptName === fresh.scriptName)
    if (idx >= 0) {
      list[idx] = { ...fresh, id: list[idx].id, scriptName: list[idx].scriptName }
    } else list.push(fresh)
  }
  project.statusMessage = '已注入状态栏（对AI隐藏 + 状态栏界面，可在「正则」页查看）'
}

watch(
  () => project.project?.card.path,
  () => loadFromCard(),
  { immediate: true }
)

const jsonDraft = ref('')

// JSON 编辑器默认值 = 当前 mock（由 schema 生成），用户可直接在此基础上修改
watch(
  () => mockData.value,
  (val) => {
    jsonDraft.value = JSON.stringify(val, null, 2)
  },
  { immediate: true, deep: true }
)

function saveMockFromJson(): void {
  try {
    mockData.value = JSON.parse(jsonDraft.value)
  } catch {
    // 忽略无效 JSON
  }
}

/** JSON 编辑器回车自动缩进：继承当前行缩进，前一个字符是 { 或 [ 时多加两级 */
function onJsonEnter(e: KeyboardEvent): void {
  if (e.shiftKey || e.ctrlKey || e.metaKey) return
  e.preventDefault()
  const ta = e.target as HTMLTextAreaElement
  const val = jsonDraft.value
  const start = ta.selectionStart
  const lineStart = val.lastIndexOf('\n', start - 1) + 1
  const curLine = val.slice(lineStart, start)
  const m = curLine.match(/^[ \t]*/)
  let indent = m ? m[0] : ''
  const before = start > 0 ? val[start - 1] : ''
  if (before === '{' || before === '[') indent += '  '
  const insert = '\n' + indent
  jsonDraft.value = val.slice(0, start) + insert + val.slice(start)
  const pos = start + insert.length
  requestAnimationFrame(() => {
    ta.selectionStart = pos
    ta.selectionEnd = pos
  })
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page status-page">
    <div class="status-head">
      <h2>状态栏</h2>
      <button class="btn btn-primary" :disabled="!statusBarHtml.trim()" @click="injectToCard">
        ⬇ 注入到当前卡
      </button>
    </div>

    <div class="match-bar">
      <span class="match-info">
        已匹配正则：
        <b>{{ matchedReplace || '（未找到，可用下方手动指认或直接编辑生成）' }}</b>
      </span>
      <select v-model="manualPick" class="text-input pick-select" @change="applyManualPick">
        <option value="">— 手动指认一条正则作为底稿 —</option>
        <option v-for="r in candidateRegexes" :key="r.id" :value="r.id">
          {{ r.scriptName }}（{{ r.findRegex.slice(0, 40) }}）
        </option>
      </select>
    </div>

    <div class="status-body">
      <div class="sandbox-col">
        <h3>沙盒预览</h3>
        <div class="sandbox-box">
          <SandboxIframe :html="statusBarHtml" :mock-data="mockData" />
        </div>
        <p class="hint">可编辑右侧变量实时渲染；交互按钮会写回 mock 变量。</p>
      </div>

      <div class="edit-col">
        <h3>变量 mock 编辑</h3>
        <div class="mock-editor">
          <div v-for="{ path, node } in schemaFields" :key="path" class="mock-row">
            <span class="mock-path">{{ path }}</span>
            <input
              v-if="node.type === 'number'"
              :value="getDeep(mockData, path)"
              type="number"
              class="mock-input"
              @input="setDeep(mockData, path, ($event.target as HTMLInputElement).value)"
            />
            <input
              v-else-if="node.type === 'boolean'"
              type="checkbox"
              :checked="Boolean(getDeep(mockData, path))"
              @change="setDeep(mockData, path, ($event.target as HTMLInputElement).checked)"
            />
            <input
              v-else
              :value="getDeep(mockData, path)"
              class="mock-input"
              @input="setDeep(mockData, path, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <p v-if="schemaFields.length === 0" class="empty-hint">
            画布中暂无字段，先到 Schema 编辑器添加。
          </p>
        </div>

        <details class="json-block" open>
          <summary>以 JSON 编辑 mock 变量（已按 schema 生成默认值，可直接修改）</summary>
          <textarea
            v-model="jsonDraft"
            class="json-area"
            rows="6"
            spellcheck="false"
            @keydown.enter="onJsonEnter"
          ></textarea>
          <button class="btn-ghost" @click="saveMockFromJson">应用 JSON</button>
        </details>

        <LlmChatPanel
          feature-id="statusbar"
          show-worldbook-select
          :existing-info="statusBarHtml"
          @result="
            (content) => {
              // 无条件剥掉可能的 ```html ``` 包裹（提示词已要求不包裹，这里兜底防双重包裹）
              const m = content
                .replace(/^```[^\n]*\n?/, '')
                .replace(/```\s*$/, '')
                .trim()
              if (m) statusBarHtml = m
            }
          "
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}
.status-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
}
.match-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  background: rgba(19, 25, 38, 0.6);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.match-info {
  color: var(--text-muted);
  font-size: 12px;
}
.match-info b {
  color: var(--accent-bright);
}
.pick-select {
  width: 320px;
}
h2 {
  color: #ffc94d;
  margin: 0;
}
.status-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 14px;
  padding: 0 16px 16px;
}
.sandbox-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.edit-col {
  width: 380px;
  min-width: 340px;
  overflow-y: auto;
}
h3 {
  color: #d4dbe6;
  font-size: 13px;
  margin: 0 0 8px;
}
.sandbox-box {
  flex: 1;
  min-height: 200px;
}
.hint {
  color: #79869a;
  font-size: 12px;
  margin-top: 8px;
}
.mock-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mock-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mock-path {
  color: #a9b3c3;
  font-size: 12px;
  font-family: Consolas, monospace;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mock-input {
  width: 130px;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 13px;
}
.empty-hint {
  color: #79869a;
  font-size: 12px;
}
.json-block {
  margin-top: 16px;
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 8px;
  padding: 10px;
}
.json-block summary {
  color: #a9b3c3;
  font-size: 13px;
  cursor: pointer;
}
.json-area {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 8px;
  font-family: Consolas, monospace;
  font-size: 12px;
  resize: vertical;
}
.btn-ghost {
  margin-top: 8px;
  background: transparent;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.btn-ghost:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
</style>
