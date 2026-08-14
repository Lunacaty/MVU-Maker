<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import { newId } from '../../../shared/schema'

const project = useProjectStore()
const expandedKey = ref<string | null>(null)
const newScriptName = ref('')

const scripts = computed(() => project.project?.scripts ?? {})

function toggleExpanded(key: string): void {
  expandedKey.value = expandedKey.value === key ? null : key
}

function isMvuScript(key: string): boolean {
  const s = scripts.value[key]
  const content = s?.content ?? ''
  return (
    key === 'MVU' ||
    key === 'Zod' ||
    content.includes('MagVarUpdate') ||
    content.includes('registerMvuSchema')
  )
}

/**
 * 可读脚本名：脚本对象可能以数字/UUID 作 key（某些卡序列化问题），
 * 此时从脚本内容推导可读名（MagVarUpdate → MVU、registerMvuSchema → Zod、import URL 取包名）。
 */
function displayName(key: string): string {
  const isPlainName =
    !/^\d+$/.test(key) && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)
  if (isPlainName) return key
  const s = scripts.value[key]
  if (!s) return key
  const c = s.content
  if (c.includes('MagVarUpdate')) return 'MVU'
  if (c.includes('registerMvuSchema')) return 'Zod'
  // 从 import URL 推导：gh/用户/仓库/...
  const m = c.match(/import\s+'https?:\/\/[^/]+\/gh\/([^/]+)\/([^/]+)/)
  if (m) return `${m[1]}/${m[2]}`
  const m2 = c.match(/import\s+'https?:\/\/[^/]+\/npm\/([^@/]+)/)
  if (m2) return m2[1]
  return key
}

function addScript(): void {
  if (!project.project) return
  // 新增时可自定义脚本名（留空自动命名）
  const name = newScriptName.value.trim() || `脚本${Object.keys(scripts.value).length + 1}`
  if (project.project.scripts[name]) {
    project.showToast(`脚本名「${name}」已存在`, 'err')
    return
  }
  project.project.scripts[name] = {
    type: 'script',
    content: '',
    enabled: true,
    id: newId('s'),
    info: '',
    button: { enabled: true, buttons: [] },
    data: {}
  }
  newScriptName.value = ''
  expandedKey.value = name
}

/** 重命名脚本：改 Record 的 key（MVU/Zod 自动脚本禁止改名） */
function renameScript(oldKey: string, newKey: string): void {
  if (!project.project) return
  const name = newKey.trim()
  if (!name || name === oldKey) return
  if (isMvuScript(oldKey)) {
    project.showToast('MVU 自动脚本不可改名', 'err')
    return
  }
  if (project.project.scripts[name]) {
    project.showToast(`脚本名「${name}」已存在`, 'err')
    return
  }
  const s = project.project.scripts[oldKey]
  delete project.project.scripts[oldKey]
  project.project.scripts[name] = s
  expandedKey.value = name
  project.showToast(`已重命名为「${name}」`)
}

function removeScript(key: string): void {
  if (!project.project) return
  delete project.project.scripts[key]
  if (expandedKey.value === key) expandedKey.value = null
}

function toggle(key: string): void {
  const s = scripts.value[key]
  if (s) s.enabled = !s.enabled
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>酒馆助手脚本</h2>
      <div class="add-row">
        <input
          v-model="newScriptName"
          class="text-input name-input"
          placeholder="脚本名（留空自动命名）"
          @keydown.enter.prevent="addScript"
        />
        <button class="btn-primary" @click="addScript">＋ 新增脚本</button>
      </div>
    </div>
    <p class="desc">点击脚本展开编辑（默认折叠）。可修改脚本名（MVU 自动脚本除外）。</p>

    <div class="script-list">
      <div
        v-for="(s, key) in scripts"
        :key="key"
        class="script-card"
        :class="{ expanded: expandedKey === key }"
      >
        <div class="script-head" @click="toggleExpanded(key)">
          <span class="chevron" :class="{ open: expandedKey === key }">▸</span>
          <span class="name">{{ displayName(key) }}</span>
          <span
            v-if="isMvuScript(key) || displayName(key) === 'MVU' || displayName(key) === 'Zod'"
            class="tag"
            >MVU 自动</span
          >
          <span class="content-preview">{{ s.content.slice(0, 80) }}</span>
          <span class="toggle" :class="{ on: s.enabled }" @click.stop="toggle(key)">
            {{ s.enabled ? '启用' : '停用' }}
          </span>
          <button class="btn-x" @click.stop="removeScript(key)">✕</button>
        </div>

        <div v-if="expandedKey === key" class="script-editor">
          <label class="field-label">脚本名</label>
          <input
            :value="displayName(key)"
            class="text-input"
            :disabled="isMvuScript(key)"
            @change="renameScript(key, ($event.target as HTMLInputElement).value)"
          />
          <p v-if="isMvuScript(key)" class="hint">⚠ MVU 自动脚本，名称与内容都不可修改。</p>
          <label class="field-label">内容</label>
          <textarea
            v-model="s.content"
            class="text-area mono"
            rows="14"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
      <p v-if="Object.keys(scripts).length === 0" class="empty">暂无脚本</p>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 10px;
  flex-wrap: wrap;
}
.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name-input {
  width: 220px;
}
.text-input {
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}
.field-label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin: 10px 0 4px;
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
.script-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.script-card {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 8px;
  transition: border-color 0.15s;
}
.script-card:hover {
  border-color: #f5a623;
}
.script-card.expanded {
  border-color: #f5a623;
}
.script-head {
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
.name {
  color: #e8ecf3;
  font-weight: 600;
  min-width: 100px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  background: #3a3016;
  color: #ffc94d;
  font-size: 11px;
  border-radius: 8px;
  padding: 1px 6px;
}
.content-preview {
  flex: 1;
  color: #79869a;
  font-family: Consolas, monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toggle {
  font-size: 11px;
  color: #79869a;
  border: 1px solid #32415f;
  border-radius: 8px;
  padding: 1px 8px;
  cursor: pointer;
}
.toggle.on {
  color: #3ddc84;
  border-color: #2a7a3a;
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
.script-editor {
  border-top: 1px solid #25304a;
  padding: 14px 16px 16px;
}
.script-editor h3 {
  font-size: 13px;
  margin: 0 0 8px;
  color: #d4dbe6;
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
  font-size: 13px;
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
