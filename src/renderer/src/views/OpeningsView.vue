<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import SandboxIframe from '../components/SandboxIframe.vue'
import { makeRegex, PLACEHOLDER_CREATE_CARD } from '../../../shared/templates'
import { canvasToInitvarData, canvasToInitvarYaml } from '../../../shared/schema'
import type { Opening, OpeningType, RegexScript } from '../../../shared/types'

const project = useProjectStore()
const editing = ref<Opening | null>(null)
const mockData = ref<Record<string, unknown>>({})

const openings = computed(() => project.project?.openings ?? [])

const typeOptions: { id: OpeningType; label: string; desc: string }[] = [
  { id: 'text', label: '纯文字', desc: '开场白只含剧情文本' },
  { id: 'createCard', label: '纯创建卡片', desc: '只显示捏人界面' },
  { id: 'mixed', label: '混合', desc: '剧情文本 + 创建卡片' }
]

// 预览：混合/创建卡片时在正文中应用"临时正则"（把用户自定义查找目标替换为卡片 HTML）；
// 纯文字直接显示
const previewHtml = computed(() => {
  const o = editing.value
  if (!o) return ''
  const esc = (s: string): string => s.replace(/</g, '&lt;').replace(/\n/g, '<br>')
  const applyTempCard = (text: string): string => {
    const target = (o.createCardFindTarget || '').trim()
    const html = o.createCardHtml?.trim()
    if (!target || !html) return esc(text)
    // 临时正则：仅替换查找目标本身，正文其余部分正常转义
    const parts = text.split(target)
    return parts.map((seg, i) => (i < parts.length - 1 ? esc(seg) + html : esc(seg))).join('')
  }
  if (o.type === 'createCard') {
    const body = applyTempCard(o.text)
    if (!body.trim()) {
      return `<body style="margin:0;background:#000;color:#fff"><div style="padding:10px;color:#666">在正文中写入查找目标 ${esc(o.createCardFindTarget || PLACEHOLDER_CREATE_CARD)} 以预览角色创建卡片</div></body>`
    }
    return `<body style="margin:0;background:#000;color:#fff">${body}</body>`
  }
  if (o.type === 'mixed') {
    return `<body style="margin:0;background:#000;color:#fff;padding:10px;font-size:13px">${applyTempCard(o.text)}</body>`
  }
  return `<body style="margin:0;background:#000;color:#fff;padding:10px;font-size:13px">${esc(o.text)}</body>`
})

function addOpening(): void {
  if (!project.project) return
  const idx = project.project.openings.length
  project.project.openings.push({
    key: idx === 0 ? 'main' : `alt-${idx - 1}`,
    text: '',
    type: 'text'
  })
  editing.value = project.project.openings[project.project.openings.length - 1]
}

function removeOpening(o: Opening): void {
  if (!project.project) return
  const idx = project.project.openings.indexOf(o)
  if (idx >= 0) project.project.openings.splice(idx, 1)
  if (editing.value === o) editing.value = null
}

// 开场白文本辅助：LLM 生成结果 → 写入当前开场白正文
function onLlmResult(content: string): void {
  if (!editing.value) return
  const cleaned = content
    .replace(/^```[^\n]*\n/, '')
    .replace(/```\s*$/, '')
    .trim()
  editing.value.text = cleaned
}

/** 按 Schema 结构填充 initvar 骨架：只列出全部字段、值全空（不写 prefault，避免与世界书初始化值冲突） */
function fillInitvar(): void {
  if (!editing.value || !project.project) return
  if (Object.keys(canvasToInitvarData(project.project.schemaCanvas)).length === 0) {
    project.showToast('Schema 画布为空，无可填充的字段', 'err')
    return
  }
  editing.value.initvarOverride = canvasToInitvarYaml(project.project.schemaCanvas, false)
  project.statusMessage = '已按 Schema 结构填充 initvar 字段骨架（值为空，可手动修改）'
}

/** 清空 initvar override */
function clearInitvar(): void {
  if (!editing.value) return
  editing.value.initvarOverride = ''
  project.statusMessage = '已清空 initvar override'
}

// 角色创建卡片辅助：LLM 生成结果 → 写入当前开场白的专属卡片 HTML
function onCreateCardResult(content: string): void {
  if (!editing.value) return
  const cleaned = content
    .replace(/^```[^\n]*\n/, '')
    .replace(/```\s*$/, '')
    .trim()
  if (cleaned) editing.value.createCardHtml = cleaned
}

/** 确认注入：追加占位符 + 注入「对AI隐藏创建卡片」与命名替换正则 */
function injectOpeningCard(): void {
  if (!project.project || !editing.value) return
  const o = editing.value
  if (!o.createCardHtml?.trim()) {
    project.showToast('请先生成角色创建卡片 HTML', 'err')
    return
  }
  if (o.type !== 'createCard' && o.type !== 'mixed') return
  // 查找目标由用户在正文中自定义：程序不再自动写入，只校验正文里确实出现了该目标
  const target = (o.createCardFindTarget || '').trim() || PLACEHOLDER_CREATE_CARD
  if (!o.text.includes(target)) {
    project.showToast(`开场白正文中未找到查找目标「${target}」，请先写入正文以预览卡片`, 'err')
    return
  }
  const name = (o.createCardRegexName?.trim() || `角色创建卡片-${o.key}`).trim()
  const list = project.project.regexes
  const upsert = (fresh: RegexScript): void => {
    const idx = list.findIndex((r) => r.scriptName === fresh.scriptName)
    if (idx >= 0) list[idx] = { ...fresh, id: list[idx].id, scriptName: list[idx].scriptName }
    else list.push(fresh)
  }
  // 注入两件正则：对AI隐藏（查找目标不进 AI 上下文）+ 命名替换（目标 → 卡片 HTML）
  upsert(
    makeRegex('开场白对AI隐藏', target, '', {
      promptOnly: true,
      markdownOnly: false,
      placement: [2]
    })
  )
  upsert(
    makeRegex(name, target, '```\n' + o.createCardHtml.trim() + '\n```', {
      promptOnly: false,
      markdownOnly: true,
      placement: [2]
    })
  )
  project.showToast(`已注入「${name}」与「开场白对AI隐藏」，可在「正则」页查看`)
}

watch(
  () => editing.value?.text,
  () => {
    mockData.value = {}
  }
)
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>开场白</h2>
      <button class="btn-primary" @click="addOpening">＋ 新增开场白</button>
    </div>
    <p class="desc">
      每条开场白可选类型：纯文字 / 纯创建卡片 / 混合。可附加 initvar
      override（不同开场白启动不同初始变量）。
    </p>

    <div class="opening-list">
      <div
        v-for="o in openings"
        :key="o.key"
        class="opening-card"
        @click="
          () => {
            console.log('[opening] 点击', o.key)
            editing = o
          }
        "
      >
        <div class="opening-meta">
          <span class="tag">{{ o.key === 'main' ? '主开场白' : '备用' }}</span>
          <span class="tag" :class="o.type">{{
            typeOptions.find((t) => t.id === o.type)?.label
          }}</span>
          <span class="char-count">{{ o.text.length }} 字</span>
          <button class="btn-x" @click.stop="removeOpening(o)">✕</button>
        </div>
        <div class="opening-preview">{{ o.text.slice(0, 120) || '（空）' }}</div>
      </div>
    </div>

    <div v-if="editing" class="editor">
      <h3>编辑开场白</h3>
      <div class="type-select">
        <button
          v-for="t in typeOptions"
          :key="t.id"
          class="type-btn"
          :class="{ active: editing.type === t.id }"
          @click="editing.type = t.id"
        >
          {{ t.label }}<small>{{ t.desc }}</small>
        </button>
      </div>

      <label class="field-label">正文</label>
      <textarea
        v-model="editing.text"
        class="text-area"
        rows="12"
        placeholder="开场白剧情文本..."
      ></textarea>

      <div class="initvar-block">
        <label class="field-label">initvar override（可选，YAML）</label>
        <div class="initvar-toolbar">
          <button class="btn btn-ghost btn-sm" @click="fillInitvar">
            ⬇ 填充（按 Schema 结构）
          </button>
          <button class="btn btn-ghost btn-sm" @click="clearInitvar">🗑 清空</button>
          <span class="hint"
            >填充仅列出 Schema 全部字段、值为空（不写默认值，避免与世界书初始化冲突）</span
          >
        </div>
        <textarea
          v-model="editing.initvarOverride"
          class="text-area yaml-area"
          rows="8"
          placeholder="# 该开场白启动时覆盖的初始变量（YAML 结构需过 schema 校验）"
        ></textarea>
        <p class="hint">
          导出时会以 <code>&lt;UpdateVariable&gt;&lt;initvar&gt;</code> 块嵌入该开场白末尾
        </p>
      </div>

      <div class="preview-block">
        <h3>前端预览</h3>
        <div class="preview-box">
          <SandboxIframe :html="previewHtml" :mock-data="mockData" />
        </div>
        <p class="hint">
          查找目标写入正文的位置会渲染本条专用卡片（临时正则）；纯文字直接预览剧情文本。
        </p>
      </div>

      <div class="ai-assist">
        <template v-if="editing.type === 'text' || editing.type === 'mixed'">
          <LlmChatPanel feature-id="opening" :existing-info="editing.text" @result="onLlmResult" />
        </template>

        <template v-if="editing.type === 'createCard' || editing.type === 'mixed'">
          <div class="panel card-assist">
            <h3>🎭 角色创建卡片辅助</h3>
            <p class="hint">
              让 AI 编写该开场白专用的捏人卡片 HTML（纯原生 JS，写变量后可用
              <code>triggerSlash('/trigger')</code> 自动触发 AI 开局）。不同开场白可用不同正则名。
            </p>
            <label class="field-label"
              >查找目标（写入开场白正文即可在预览中看到卡片，可自定义）</label
            >
            <input
              v-model="editing.createCardFindTarget"
              class="text-input"
              :placeholder="'默认：' + PLACEHOLDER_CREATE_CARD"
            />
            <label class="field-label">正则名（该卡片替换正则的名字）</label>
            <input
              v-model="editing.createCardRegexName"
              class="text-input"
              :placeholder="'默认：角色创建卡片-' + editing.key"
            />
            <LlmChatPanel
              feature-id="createcard"
              :existing-info="editing.createCardHtml"
              @result="onCreateCardResult"
            />
            <div v-if="editing.createCardHtml" class="card-draft">
              <label class="field-label">生成的 HTML（可编辑）</label>
              <textarea
                v-model="editing.createCardHtml"
                class="text-area mono"
                rows="10"
                spellcheck="false"
              ></textarea>
            </div>
            <button class="btn btn-primary inject-btn" @click="injectOpeningCard">
              ✔ 确认注入开场白和正则
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
h2,
h3 {
  color: #ffc94d;
}
.desc {
  color: #79869a;
  font-size: 13px;
  margin-bottom: 16px;
}
.opening-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.opening-card {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
}
.opening-card:hover {
  border-color: #f5a623;
}
.opening-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.tag {
  background: #1c2434;
  color: #a9b3c3;
  border: 1px solid #32415f;
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
}
.tag.text {
  color: #a9b3c3;
}
.tag.createCard {
  color: #ffc94d;
  border-color: #f5a623;
}
.tag.mixed {
  color: #58a6ff;
  border-color: #58a6ff;
}
.char-count {
  color: #79869a;
  font-size: 11px;
}
.btn-x {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #5d6a80;
  cursor: pointer;
}
.btn-x:hover {
  color: #ff5d5d;
}
.opening-preview {
  color: #a9b3c3;
  font-size: 12px;
  white-space: pre-wrap;
}
.editor {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  padding: 16px;
}
.type-select {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}
.type-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #a9b3c3;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  font-size: 13px;
}
.type-btn small {
  color: #5d6a80;
  font-size: 11px;
}
.type-btn.active {
  border-color: #f5a623;
  color: #ffc94d;
}
.field-label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin: 12px 0 4px;
}
.text-area {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 8px;
  padding: 10px;
  font-family: 'Microsoft YaHei', monospace;
  font-size: 13px;
  resize: vertical;
  line-height: 1.5;
}
.yaml-area {
  font-family: Consolas, monospace;
}
.initvar-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.initvar-toolbar .hint {
  margin-top: 0;
  color: #5d6a80;
}
.preview-block {
  margin-top: 16px;
}
.preview-block h3 {
  margin-bottom: 8px;
}
.preview-box {
  height: 320px;
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}
.hint {
  color: #79869a;
  font-size: 12px;
  margin-top: 6px;
}
code {
  color: #ffc94d;
}
.ai-assist {
  margin-top: 16px;
}
.card-assist {
  margin-top: 16px;
}
.card-assist .text-input {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
}
.card-assist .mono {
  font-family: Consolas, monospace;
}
.inject-btn {
  margin-top: 12px;
  width: 100%;
}
.btn-primary {
  background: linear-gradient(135deg, #f5a623, #d98d1f);
  color: #0d1320;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}
</style>
