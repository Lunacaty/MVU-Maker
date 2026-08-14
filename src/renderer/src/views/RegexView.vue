<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import type { RegexScript } from '../../../shared/types'
import { makeRegex } from '../../../shared/templates'

const project = useProjectStore()
const expandedId = ref<string | null>(null)
const testText = ref('')
const testResult = ref<{ ok: boolean; error?: string; output?: string } | null>(null)

const regexes = computed(() => project.project?.regexes ?? [])

function toggleExpanded(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

function addRegex(): void {
  if (!project.project) return
  const r = makeRegex('新正则', '', '', {})
  project.project.regexes.push(r)
  expandedId.value = r.id
}

function removeRegex(r: RegexScript): void {
  if (!project.project) return
  const idx = project.project.regexes.indexOf(r)
  if (idx >= 0) project.project.regexes.splice(idx, 1)
  if (expandedId.value === r.id) expandedId.value = null
}

function move(index: number, dir: -1 | 1): void {
  if (!project.project) return
  const list = project.project.regexes
  const target = index + dir
  if (target < 0 || target >= list.length) return
  const tmp = list[index]
  list[index] = list[target]
  list[target] = tmp
}

// 拖拽排序（HTML5 drag & drop），与 ↑/↓ 按钮并存
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(i: number): void {
  dragIndex.value = i
}

function onDrop(i: number): void {
  if (!project.project || dragIndex.value === null || dragIndex.value === i) {
    dragIndex.value = null
    dragOverIndex.value = null
    return
  }
  const list = project.project.regexes
  const [moved] = list.splice(dragIndex.value, 1)
  list.splice(i, 0, moved)
  dragIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd(): void {
  dragIndex.value = null
  dragOverIndex.value = null
}

async function runTest(r: RegexScript): Promise<void> {
  if (r.replaceString !== '') {
    const res = await window.cardTool.testRegexReplace(r.findRegex, r.replaceString, testText.value)
    testResult.value = res
  } else {
    const res = await window.cardTool.testRegex(r.findRegex, testText.value)
    testResult.value = res
  }
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>正则</h2>
      <button class="btn-primary" @click="addRegex">＋ 新增正则</button>
    </div>
    <p class="desc">
      顺序即渲染管道顺序（上方的先执行）。每个界面元素 = 隐藏(promptOnly) + 替换(markdownOnly)
      两条配对。点击条目展开编辑（默认折叠），可拖拽行头或点 ↑/↓ 调整顺序。
    </p>

    <div class="regex-list">
      <div
        v-for="(r, i) in regexes"
        :key="r.id"
        class="regex-card"
        :class="{
          disabled: r.disabled,
          expanded: expandedId === r.id,
          'drag-over': dragOverIndex === i
        }"
      >
        <div
          class="regex-head"
          draggable="true"
          @click="toggleExpanded(r.id)"
          @dragstart="onDragStart(i)"
          @dragover.prevent="dragOverIndex = i"
          @drop.prevent="onDrop(i)"
          @dragend="onDragEnd"
        >
          <span class="drag-grip">⠿</span>
          <span class="chevron" :class="{ open: expandedId === r.id }">▸</span>
          <span class="idx">{{ i + 1 }}</span>
          <span class="name">{{ r.scriptName }}</span>
          <span v-if="r.promptOnly" class="badge badge-info">AI侧</span>
          <span v-if="r.markdownOnly" class="badge badge-ok">显示侧</span>
          <span class="regex-preview">{{ r.findRegex.slice(0, 60) }}</span>
          <span class="move-btns">
            <button class="mini" @click.stop="move(i, -1)">↑</button>
            <button class="mini" @click.stop="move(i, 1)">↓</button>
          </span>
          <button class="btn-x" @click.stop="removeRegex(r)">✕</button>
        </div>

        <div v-if="expandedId === r.id" class="regex-editor">
          <label class="field-label">名称</label>
          <input v-model="r.scriptName" class="text-input" />

          <div class="row">
            <label class="check"
              ><input v-model="r.promptOnly" type="checkbox" /> 仅格式提示词（AI侧）</label
            >
            <label class="check"
              ><input v-model="r.markdownOnly" type="checkbox" /> 仅格式显示（显示侧）</label
            >
            <label class="check"><input v-model="r.runOnEdit" type="checkbox" /> runOnEdit</label>
            <label class="check"><input v-model="r.disabled" type="checkbox" /> 禁用</label>
          </div>

          <label class="field-label">findRegex</label>
          <textarea v-model="r.findRegex" class="text-input mono" rows="2"></textarea>

          <label class="field-label">replaceString</label>
          <textarea v-model="r.replaceString" class="text-input mono" rows="4"></textarea>

          <div class="test-area">
            <label class="field-label">测试文本</label>
            <textarea v-model="testText" class="text-input mono" rows="4"></textarea>
            <button class="btn-ghost" @click="runTest(r)">▶ 测试替换</button>
            <div v-if="testResult" class="test-result" :class="{ bad: !testResult.ok }">
              <template v-if="testResult.ok"
                >替换结果：
                <pre>{{ testResult.output }}</pre>
              </template>
              <template v-else>错误：{{ testResult.error }}</template>
            </div>
          </div>
        </div>
      </div>
      <p v-if="regexes.length === 0" class="empty">暂无正则</p>
    </div>
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
.regex-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.regex-card {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 8px;
  transition: border-color 0.15s;
}
.regex-card:hover {
  border-color: #f5a623;
}
.regex-card.disabled {
  opacity: 0.5;
}
.regex-card.expanded {
  border-color: #f5a623;
}
.regex-card.drag-over {
  border-color: #58a6ff;
  box-shadow: 0 0 0 1px #58a6ff;
}
.drag-grip {
  color: #5d6a80;
  font-size: 12px;
  cursor: grab;
  user-select: none;
}
.regex-head {
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
.idx {
  color: #5d6a80;
  font-size: 12px;
  width: 20px;
}
.name {
  color: #e8ecf3;
  font-weight: 600;
  min-width: 140px;
}
.dir {
  font-size: 11px;
  background: #3a3016;
  color: #ffc94d;
  border-radius: 8px;
  padding: 1px 6px;
}
.regex-preview {
  flex: 1;
  color: #79869a;
  font-family: Consolas, monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.move-btns {
  display: flex;
  gap: 2px;
}
.mini {
  background: transparent;
  border: none;
  color: #5d6a80;
  cursor: pointer;
  font-size: 11px;
}
.mini:hover {
  color: #ffc94d;
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
.regex-editor {
  border-top: 1px solid #25304a;
  padding: 14px 16px 16px;
}
.field-label {
  display: block;
  color: #79869a;
  font-size: 12px;
  margin: 12px 0 4px;
}
.regex-editor > .field-label:first-child {
  margin-top: 0;
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
.mono {
  font-family: Consolas, monospace;
  resize: vertical;
}
.row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.check {
  color: #a9b3c3;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.presets {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.preset-btn {
  background: #1c2434;
  border: 1px solid #32415f;
  color: #a9b3c3;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.preset-btn:hover {
  color: #ffc94d;
  border-color: #f5a623;
}
.test-area {
  margin-top: 16px;
}
.btn-ghost {
  background: transparent;
  border: 1px solid #32415f;
  color: #d4dbe6;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  margin-top: 8px;
}
.btn-ghost:hover {
  border-color: #f5a623;
  color: #ffc94d;
}
.test-result {
  margin-top: 10px;
  background: #0b1019;
  border: 1px solid #2a7a3a;
  border-radius: 6px;
  padding: 8px;
  color: #3ddc84;
  font-size: 12px;
}
.test-result.bad {
  border-color: #7a2a3a;
  color: #ff5d5d;
}
.test-result pre {
  white-space: pre-wrap;
  color: #e8ecf3;
  font-family: Consolas, monospace;
  font-size: 12px;
  margin-top: 4px;
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
