<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import type { WorldInfoEntry } from '../../../shared/types'

const project = useProjectStore()
const expandedId = ref<number | null>(null)

const entries = computed(() => project.project?.worldbookEntries ?? [])

function toggleEntry(id: number): void {
  expandedId.value = expandedId.value === id ? null : id
}

function addEntry(): void {
  if (!project.project) return
  const maxId = entries.value.reduce((m, e) => Math.max(m, Number(e.id) || 0), -1) + 1
  const entry: WorldInfoEntry = {
    keys: [],
    secondary_keys: [],
    comment: '新条目',
    content: '',
    constant: false,
    selective: false,
    insertion_order: 50,
    enabled: true,
    position: '@D',
    extensions: { position: 6, depth: 0, role: 0, order: 50 },
    id: maxId
  }
  project.project.worldbookEntries.push(entry)
  expandedId.value = entry.id
}

function removeEntry(e: WorldInfoEntry): void {
  if (!project.project) return
  const idx = project.project.worldbookEntries.indexOf(e)
  if (idx >= 0) project.project.worldbookEntries.splice(idx, 1)
  if (expandedId.value === e.id) expandedId.value = null
}

const isMvuEntry = (e: WorldInfoEntry): boolean => {
  const c = e.comment.toLowerCase()
  return c.includes('[initvar]') || c.includes('[mvu_update]') || e.comment === '变量列表'
}

// 插入位置（position 字符串 + extensions.position 数字同步）
const POSITION_OPTIONS = [
  { label: '角色定义前', position: 'before_char', num: 0 },
  { label: '角色定义后', position: 'after_char', num: 1 },
  { label: '示例消息前', position: 'before_example_messages', num: 2 },
  { label: '示例消息后', position: 'after_example_messages', num: 3 },
  { label: '作者注释前', position: 'before_authors_note', num: 4 },
  { label: '作者注释后', position: 'after_authors_note', num: 5 },
  { label: '按深度插入（@D）', position: '@D', num: 6 }
]
const ROLE_OPTIONS = [
  { label: '系统', role: 0 },
  { label: '用户', role: 1 },
  { label: 'AI', role: 2 }
]

function currentPositionNum(e: WorldInfoEntry): number {
  const byString = POSITION_OPTIONS.find((o) => o.position === e.position)
  if (byString) return byString.num
  return e.extensions.position ?? 6
}

function positionLabel(e: WorldInfoEntry): string {
  const num = currentPositionNum(e)
  return POSITION_OPTIONS.find((o) => o.num === num)?.label ?? '未知'
}

function applyPosition(e: WorldInfoEntry, num: number): void {
  const opt = POSITION_OPTIONS.find((o) => o.num === num)
  if (!opt) return
  e.position = opt.position
  e.extensions.position = opt.num
}

const llmTarget = computed(() =>
  expandedId.value === null ? null : (entries.value.find((e) => e.id === expandedId.value) ?? null)
)

/** 位置中文标签 → (position 字符串, extensions.position 数字) */
const POSITION_LABEL_MAP: Record<string, [string, number]> = {
  角色定义前: ['before_char', 0],
  角色定义后: ['after_char', 1],
  示例消息前: ['before_example_messages', 2],
  示例消息后: ['after_example_messages', 3],
  作者注释前: ['before_authors_note', 4],
  作者注释后: ['after_authors_note', 5],
  按深度: ['@D', 6],
  按深度插入: ['@D', 6],
  '@D': ['@D', 6],
  before_char: ['before_char', 0],
  after_char: ['after_char', 1],
  before_example_messages: ['before_example_messages', 2],
  after_example_messages: ['after_example_messages', 3],
  before_authors_note: ['before_authors_note', 4],
  after_authors_note: ['after_authors_note', 5]
}

/** 角色中文标签 → extensions.role */
const ROLE_LABEL_MAP: Record<string, number> = {
  系统: 0,
  用户: 1,
  AI: 2,
  system: 0,
  user: 1,
  assistant: 2
}

/**
 * 解析 LLM 输出中的一个 "### 条目名" 块：
 * 块开头可带 --- 包裹的配置 frontmatter（constant/keys/position/enabled/role），其余为正文。
 */
function parseEntryBlock(title: string, body: string, maxId: number): WorldInfoEntry | null {
  const entry: WorldInfoEntry = {
    keys: [],
    secondary_keys: [],
    comment: title,
    content: body,
    constant: false,
    selective: false,
    insertion_order: 50,
    enabled: true,
    position: '@D',
    extensions: { position: 6, depth: 0, role: 0, order: 50, display_index: 0 },
    id: maxId
  }
  // 提取开头的 frontmatter：---\n ... \n---
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fm) {
    entry.content = body.slice(fm[0].length).trim()
    const cfg: Record<string, string> = {}
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*?)\s*$/)
      if (m) cfg[m[1].toLowerCase()] = m[2]
    }
    if (cfg.constant !== undefined) entry.constant = /^(true|是|蓝灯|yes|1)$/i.test(cfg.constant)
    if (cfg.enabled !== undefined) entry.enabled = !/^(false|否|停用|no|0)$/i.test(cfg.enabled)
    if (cfg.keys) {
      entry.keys = cfg.keys
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    if (cfg.position) {
      const p = POSITION_LABEL_MAP[cfg.position.trim()]
      if (p) {
        entry.position = p[0]
        entry.extensions.position = p[1]
      }
    }
    if (cfg.role) {
      const r = ROLE_LABEL_MAP[cfg.role.trim()]
      if (r !== undefined) entry.extensions.role = r
    }
    if (cfg.depth !== undefined) {
      const d = Number(cfg.depth)
      if (!Number.isNaN(d)) entry.extensions.depth = d
    }
  }
  // 绿灯 = 非恒定 + 有关键词；蓝灯 = 恒定
  entry.selective = !entry.constant && entry.keys.length > 0
  return entry
}

/** LLM 生成结果 → 解析为世界书条目（### 条目名 分隔，含 frontmatter 配置），无标题格式则追加到当前展开条目 */
function onLlmResult(content: string): void {
  if (!project.project) return
  const text = content
    .replace(/^```[^\n]*\n/, '')
    .replace(/```\s*$/, '')
    .trim()
  if (!text) return
  const blocks = text.split(/^###\s+(.+)$/m)
  if (blocks.length < 3) {
    if (llmTarget.value) {
      llmTarget.value.content += (llmTarget.value.content ? '\n\n' : '') + text
    }
    return
  }
  let maxId = entries.value.reduce((m, e) => Math.max(m, Number(e.id) || 0), -1) + 1
  let count = 0
  for (let i = 1; i < blocks.length; i += 2) {
    const title = blocks[i].trim()
    const body = (blocks[i + 1] ?? '').trim()
    if (!title) continue
    const entry = parseEntryBlock(title, body, maxId++)
    if (entry) {
      project.project.worldbookEntries.push(entry)
      count++
    }
  }
  project.showToast(`已按「### 条目名」生成 ${count} 条世界书（含灯色/关键词/位置配置）`)
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>世界书</h2>
      <button class="btn-primary" @click="addEntry">＋ 新增条目</button>
    </div>
    <p class="desc">
      点击条目展开编辑（默认折叠）。可设置插入位置：角色定义前/后、示例消息前/后、作者注释前/后或按深度插入。
    </p>

    <div class="entry-list">
      <div
        v-for="e in entries"
        :key="e.id"
        class="entry-card"
        :class="{ disabled: !e.enabled, mvu: isMvuEntry(e), expanded: expandedId === e.id }"
      >
        <div class="entry-head" @click="toggleEntry(e.id)">
          <span class="chevron" :class="{ open: expandedId === e.id }">▸</span>
          <span class="entry-name">{{ e.comment }}</span>
          <span class="badge" :class="e.constant ? 'badge-info' : 'badge-ok'">{{
            e.constant ? '蓝灯' : '绿灯'
          }}</span>
          <span class="badge" :class="e.enabled ? 'badge-ok' : 'badge-danger'">{{
            e.enabled ? '启用' : '禁用'
          }}</span>
          <span class="badge badge-warn position-badge">{{ positionLabel(e) }}</span>
          <span class="entry-keys">{{ e.keys.join(', ') }}</span>
          <button class="btn-x" @click.stop="removeEntry(e)">✕</button>
        </div>

        <div v-if="expandedId === e.id" class="entry-editor">
          <div class="editor-grid">
            <div>
              <label class="field-label">条目名</label>
              <input v-model="e.comment" class="text-input" />
            </div>
            <div>
              <label class="field-label">关键词（逗号分隔，绿灯用）</label>
              <input
                :value="e.keys.join(', ')"
                class="text-input"
                @input="
                  e.keys = ($event.target as HTMLInputElement).value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
              />
            </div>
          </div>

          <div class="row checks">
            <label class="check"><input v-model="e.constant" type="checkbox" /> 蓝灯（恒定）</label>
            <label class="check"
              ><input v-model="e.selective" type="checkbox" /> 绿灯（关键词）</label
            >
            <label class="check"><input v-model="e.enabled" type="checkbox" /> 启用</label>
          </div>

          <div class="row">
            <div>
              <label class="field-label">插入位置</label>
              <select
                :value="currentPositionNum(e)"
                class="text-input pos-select"
                @change="applyPosition(e, Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="o in POSITION_OPTIONS" :key="o.num" :value="o.num">
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div>
              <label class="field-label">角色（@D 时生效）</label>
              <select
                :value="e.extensions.role"
                class="text-input pos-select"
                @change="e.extensions.role = Number(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="o in ROLE_OPTIONS" :key="o.role" :value="o.role">
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div>
              <label class="field-label">深度（@D 用）</label>
              <input v-model="e.extensions.depth" type="number" class="text-input small" />
            </div>
            <div>
              <label class="field-label">插入顺序</label>
              <input v-model="e.insertion_order" type="number" class="text-input small" />
            </div>
          </div>

          <label class="field-label">正文</label>
          <textarea v-model="e.content" class="text-area" rows="10"></textarea>

          <p v-if="isMvuEntry(e)" class="hint">⚠ 这是 MVU 自动条目，改动会影响变量系统，请谨慎。</p>
        </div>
      </div>
      <p v-if="entries.length === 0" class="empty">暂无世界书条目</p>
    </div>

    <LlmChatPanel feature-id="worldbook" show-worldbook-select @result="onLlmResult" />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
h2,
h3 {
  color: #ffc94d;
}
.desc {
  color: #79869a;
  font-size: 12px;
  margin-bottom: 12px;
}
.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.entry-card {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 8px;
  transition: border-color 0.15s;
}
.entry-card:hover {
  border-color: #f5a623;
}
.entry-card.disabled {
  opacity: 0.5;
}
.entry-card.mvu {
  border-left: 3px solid #f5a623;
}
.entry-card.expanded {
  border-color: #f5a623;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}
.chevron {
  color: #5d6a80;
  font-size: 12px;
  transition: transform 0.15s;
  width: 12px;
  text-align: center;
}
.chevron.open {
  transform: rotate(90deg);
  color: #f5a623;
}
.entry-name {
  color: #e8ecf3;
  font-weight: 600;
  min-width: 160px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.position-badge {
  flex-shrink: 0;
}
.entry-keys {
  color: #79869a;
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-x {
  background: transparent;
  border: none;
  color: #5d6a80;
  cursor: pointer;
}
.btn-x:hover {
  color: #ff5d5d;
}
.empty {
  color: #79869a;
  text-align: center;
  padding: 20px;
}
.entry-editor {
  border-top: 1px solid #25304a;
  padding: 14px 16px 16px;
}
.editor-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 14px;
}
.field-label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin: 12px 0 4px;
}
.editor-grid .field-label:first-child {
  margin-top: 0;
}
.text-input,
.text-area {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
}
.text-input.small {
  width: 100px;
}
.pos-select {
  width: 200px;
}
.text-area {
  resize: vertical;
  font-family: Consolas, monospace;
  line-height: 1.5;
}
.row {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-top: 8px;
  flex-wrap: wrap;
}
.checks {
  gap: 20px;
}
.check {
  color: #a9b3c3;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hint {
  color: #f5a623;
  font-size: 12px;
  margin-top: 10px;
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
