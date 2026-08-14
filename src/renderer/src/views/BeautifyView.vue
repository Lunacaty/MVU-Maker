<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import SandboxIframe from '../components/SandboxIframe.vue'
import { extractHtmlFromReplace } from '../../../shared/regex'
import { extractJsonArray } from '../../../shared/json'
import {
  makeVariableBeautifyRegexes,
  makeHideVariableUpdateRegex,
  makeRegex,
  PLACEHOLDER_STATUS
} from '../../../shared/templates'
import type { RegexScript } from '../../../shared/types'

const project = useProjectStore()

// 两条美化正则（编辑底稿）
const updatingRegex = ref<RegexScript>(makeVariableBeautifyRegexes()[0])
const doneRegex = ref<RegexScript>(makeVariableBeautifyRegexes()[1])
const hideRegex = ref<RegexScript>(makeHideVariableUpdateRegex())
const hideInjected = ref(false)
// 隐藏两件套之二：对AI隐藏状态栏（占位符 → 空）
const placeholderHideRegex = ref<RegexScript>(
  makeRegex('对AI隐藏状态栏', PLACEHOLDER_STATUS, '', {
    promptOnly: true,
    markdownOnly: false,
    placement: [2]
  })
)
const placeholderInjected = ref(false)
// 从卡中匹配到的既有正则（按替换目标 <UpdateVariable>）
const matchedInfo = ref('')
const manualPick = ref('')
const candidateRegexes = computed(() =>
  (project.project?.regexes ?? []).filter((r) => r.markdownOnly && !r.promptOnly && !r.disabled)
)

/** 按"更新中/未闭合"与"完成/闭合"特征匹配既有美化正则 */
function loadFromCard(): void {
  if (!project.project) return
  const list = project.project.regexes.filter(
    (r) => !r.disabled && /update/i.test(r.findRegex ?? '')
  )
  const hasPendingMarker = (find: string): boolean =>
    find.includes('?!.*</') || find.includes('?!.*<\\\\1>')
  const updating = list.find((r) => !r.promptOnly && hasPendingMarker(r.findRegex)) ?? null
  const done = list.find((r) => !r.promptOnly && !hasPendingMarker(r.findRegex)) ?? null
  const hide = list.find((r) => r.promptOnly) ?? null

  if (updating) {
    updatingRegex.value = { ...updating, id: updating.id }
  }
  if (done) doneRegex.value = { ...done, id: done.id }
  if (hide) {
    hideRegex.value = { ...hide, id: hide.id }
    hideInjected.value = true
  }
  // 隐藏两件套之二：对AI隐藏状态栏
  const ph = list.find(
    (r) => r.scriptName === '对AI隐藏状态栏' || r.findRegex.includes('StatusPlaceHolder')
  )
  if (ph) {
    placeholderHideRegex.value = { ...ph, id: ph.id }
    placeholderInjected.value = true
  }
  const names = [updating?.scriptName, done?.scriptName].filter(Boolean)
  matchedInfo.value = names.length ? names.join(' / ') : ''
}

function applyManualPick(): void {
  if (!project.project || !manualPick.value) return
  const r = project.project.regexes.find((x) => x.id === manualPick.value)
  if (!r) return
  if (r.findRegex.includes('(?!.*<\\1>')) updatingRegex.value = { ...r }
  else doneRegex.value = { ...r }
  matchedInfo.value = r.scriptName
}

watch(
  () => project.project?.card.path,
  () => loadFromCard(),
  { immediate: true }
)

/** 点击注入「隐藏两件套」：对AI隐藏变量更新 + 对AI隐藏状态栏，各自查重 */
function injectHidePair(): void {
  if (!project.project) return
  const list = project.project.regexes
  const findVarHide = (): RegexScript | undefined =>
    list.find(
      (r) =>
        r.scriptName === '对AI隐藏变量更新' || (r.promptOnly && /update/i.test(r.findRegex ?? ''))
    )
  const findPhHide = (): RegexScript | undefined =>
    list.find((r) => r.scriptName === '对AI隐藏状态栏' || r.findRegex.includes('StatusPlaceHolder'))
  const v = findVarHide()
  const p = findPhHide()
  const results: string[] = []
  if (v) {
    hideRegex.value = { ...v, id: v.id }
    hideInjected.value = true
    results.push('「对AI隐藏变量更新」已存在')
  } else {
    const fresh = makeHideVariableUpdateRegex()
    list.push(fresh)
    hideRegex.value = fresh
    hideInjected.value = true
    results.push('「对AI隐藏变量更新」已注入')
  }
  if (p) {
    placeholderHideRegex.value = { ...p, id: p.id }
    placeholderInjected.value = true
    results.push('「对AI隐藏状态栏」已存在')
  } else {
    const fresh = makeRegex('对AI隐藏状态栏', PLACEHOLDER_STATUS, '', {
      promptOnly: true,
      markdownOnly: false,
      placement: [2]
    })
    list.push(fresh)
    placeholderHideRegex.value = fresh
    placeholderInjected.value = true
    results.push('「对AI隐藏状态栏」已注入')
  }
  const allExist = v !== undefined && p !== undefined
  project.showToast(results.join('；'), allExist ? 'err' : 'ok')
}

// ---------- 替换预览：两个内置示例文本，自动渲染 ----------
const SAMPLE_UPDATING = `白娅微微一笑，指尖划过菜单，好感度悄然上升。
<UpdateVariable>
<Analysis>
1. 主角: 心情转好，好感度上升
2. 路径: 主角/心情 已在变量列表中
</Analysis>
<JSONPatch>
[{"op":"replace","path":"/主角/心情","value":"开心"}]
</JSONPatch>`

const SAMPLE_DONE = `白娅点了点头，将药瓶收入行囊。
<UpdateVariable>
<Analysis>
1. 主角: 物品栏变化，新增药瓶
2. 路径: 主角/物品栏/药瓶 已在变量列表中
</Analysis>
<JSONPatch>
[{"op":"add","path":"/主角/物品栏/药瓶","value":{"描述":"恢复药水","数量":3}}]
</JSONPatch>
</UpdateVariable>`

const preview = ref<{ updating: string; done: string } | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null

/** 提取替换结果中的 HTML（剥掉 ```html ``` 包裹），交给沙盒渲染 */
const previewUpdatingHtml = computed(() =>
  preview.value ? extractHtmlFromReplace(preview.value.updating) : ''
)
const previewDoneHtml = computed(() =>
  preview.value ? extractHtmlFromReplace(preview.value.done) : ''
)

async function refreshPreview(): Promise<void> {
  const up = await window.cardTool.testRegexReplace(
    updatingRegex.value.findRegex,
    updatingRegex.value.replaceString,
    SAMPLE_UPDATING
  )
  const done = await window.cardTool.testRegexReplace(
    doneRegex.value.findRegex,
    doneRegex.value.replaceString,
    SAMPLE_DONE
  )
  preview.value = {
    updating: up.ok ? (up.output ?? '') : `(匹配失败 ${up.error})`,
    done: done.ok ? (done.output ?? '') : `(匹配失败 ${done.error})`
  }
}

function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    void refreshPreview()
  }, 300)
}

watch(
  () => [
    updatingRegex.value.findRegex,
    updatingRegex.value.replaceString,
    doneRegex.value.findRegex,
    doneRegex.value.replaceString
  ],
  schedulePreview,
  { immediate: true }
)

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})

// ---------- 注入 ----------
function randId(): string {
  return 'r_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-6)
}

function injectToCard(): void {
  if (!project.project) return
  const list = project.project.regexes
  const upsertKeepMeta = (fresh: RegexScript): void => {
    const existing = list.find(
      (r) => r.id === manualPick.value && r.scriptName === fresh.scriptName
    )
    const idx = existing
      ? list.indexOf(existing)
      : list.findIndex((r) => r.scriptName === fresh.scriptName)
    if (idx >= 0) list[idx] = { ...fresh, id: list[idx].id, scriptName: list[idx].scriptName }
    else list.push(fresh)
  }
  upsertKeepMeta({ ...updatingRegex.value, id: updatingRegex.value.id || randId() })
  upsertKeepMeta({ ...doneRegex.value, id: doneRegex.value.id || randId() })
  project.statusMessage = '已注入变量更新美化正则（可在「正则」页查看/调整）'
}

function applyLlmRegexes(content: string): void {
  const res = extractJsonArray(content)
  if (!res.ok) {
    project.showToast(`AI 输出解析失败，未应用：${res.error ?? ''}`, 'err')
    return
  }
  const arr = res.value ?? []
  if (arr.length === 0) {
    project.showToast('AI 输出为空数组，未应用', 'err')
    return
  }
  let applied = 0
  const unrecognized: string[] = []
  for (const r of arr) {
    if (typeof r !== 'object' || r === null) continue
    const name = String((r as { scriptName?: unknown }).scriptName ?? '')
    const find = String((r as { findRegex?: unknown }).findRegex ?? '')
    const built = makeRegex(
      String(name),
      find,
      String((r as { replaceString?: unknown }).replaceString ?? ''),
      {
        promptOnly: Boolean((r as { promptOnly?: unknown }).promptOnly),
        markdownOnly: Boolean((r as { markdownOnly?: unknown }).markdownOnly),
        placement: (r as { placement?: number[] }).placement ?? [1, 2],
        runOnEdit: Boolean((r as { runOnEdit?: unknown }).runOnEdit)
      }
    )
    const isHide = built.promptOnly && !built.markdownOnly
    // 按正则特征识别，不依赖脚本名（AI 可能自命名）：负向前瞻 (?!.*< 是"未闭合/更新中"特征
    const hasPending = find.includes('(?!.*<')
    if (isHide || String(name).includes('隐藏')) {
      hideRegex.value = built
      hideInjected.value = true
      applied++
    } else if (hasPending || String(name).includes('中美化')) {
      updatingRegex.value = built
      applied++
    } else if (
      find.includes('<\\/\\1>') ||
      String(name).includes('美化') ||
      String(name).includes('完成')
    ) {
      doneRegex.value = built
      applied++
    } else {
      unrecognized.push(String(name) || '(未命名)')
    }
  }
  if (applied === 0) {
    project.showToast(
      `未识别到可应用的正则条目${unrecognized.length ? `：${unrecognized.join('、')}` : ''}`,
      'err'
    )
  } else {
    project.showToast(
      `已应用 ${applied} 条美化正则${unrecognized.length ? `（忽略：${unrecognized.join('、')}）` : ''}`,
      'ok'
    )
  }
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>变量更新美化</h2>
      <button class="btn btn-primary" @click="injectToCard">⬇ 注入到当前卡</button>
    </div>
    <p class="desc">
      将 AI 回复末尾的
      <code>&lt;UpdateVariable&gt;</code> 命令美化为面板。注入后立即生效，可在「正则」页调整顺序。
    </p>

    <div class="match-bar">
      <span class="match-info">
        已匹配既有美化正则：<b>{{ matchedInfo || '（未找到，可手动指认或直接编辑）' }}</b>
      </span>
      <select v-model="manualPick" class="text-input pick-select" @change="applyManualPick">
        <option value="">— 手动指认一条正则作为底稿 —</option>
        <option v-for="r in candidateRegexes" :key="r.id" :value="r.id">
          {{ r.scriptName }}（{{ r.findRegex.slice(0, 40) }}）
        </option>
      </select>
    </div>

    <div class="panel regex-block">
      <div class="block-head">
        <h3>① 更新中美化 <span class="badge badge-info">更新中</span></h3>
        <p class="block-note">AI 还在输出、标签未闭合时的动画</p>
      </div>
      <label class="field-label">findRegex</label>
      <textarea
        v-model="updatingRegex.findRegex"
        class="text-area mono"
        rows="2"
        spellcheck="false"
      ></textarea>
      <label class="field-label">replaceString</label>
      <textarea
        v-model="updatingRegex.replaceString"
        class="text-area mono"
        rows="5"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="panel regex-block">
      <div class="block-head">
        <h3>② 更新完成美化 <span class="badge badge-ok">完成</span></h3>
        <p class="block-note">完整闭合标签 → 可折叠面板</p>
      </div>
      <label class="field-label">findRegex</label>
      <textarea
        v-model="doneRegex.findRegex"
        class="text-area mono"
        rows="2"
        spellcheck="false"
      ></textarea>
      <label class="field-label">replaceString</label>
      <textarea
        v-model="doneRegex.replaceString"
        class="text-area mono"
        rows="5"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="panel hide-block">
      <div class="hide-head">
        <div class="hide-info">
          <span class="hide-desc"
            >「隐藏两件套」= 对AI隐藏变量更新（删历史命令防照抄/省token）+
            对AI隐藏状态栏（占位符→空）</span
          >
        </div>
        <button class="btn btn-sm" @click="injectHidePair">＋ 注入「隐藏两件套」</button>
      </div>
      <div class="hide-status">
        <span class="badge" :class="hideInjected ? 'badge-ok' : 'badge-warn'">{{
          hideInjected ? '对AI隐藏变量更新 已注入' : '对AI隐藏变量更新 未注入'
        }}</span>
        <span class="badge" :class="placeholderInjected ? 'badge-ok' : 'badge-warn'">{{
          placeholderInjected ? '对AI隐藏状态栏 已注入' : '对AI隐藏状态栏 未注入'
        }}</span>
      </div>
      <div v-if="hideInjected" class="hide-regex">
        <label class="field-label">「对AI隐藏变量更新」findRegex（已注入，可编辑）</label>
        <textarea
          v-model="hideRegex.findRegex"
          class="text-area mono"
          rows="2"
          spellcheck="false"
        ></textarea>
      </div>
      <div v-if="placeholderInjected" class="hide-regex">
        <label class="field-label">「对AI隐藏状态栏」findRegex（已注入，可编辑）</label>
        <textarea
          v-model="placeholderHideRegex.findRegex"
          class="text-area mono"
          rows="2"
          spellcheck="false"
        ></textarea>
      </div>
    </div>

    <div class="panel preview-block">
      <div class="block-head">
        <h3>替换预览</h3>
        <button class="btn btn-ghost btn-sm" @click="refreshPreview">↻ 重新预览</button>
      </div>
      <p class="block-note">
        使用内置示例文本自动渲染（编辑正则时实时更新），无需手动粘贴；渲染结果即酒馆楼层中的真实效果。
      </p>
      <div v-if="preview" class="preview-grid">
        <div class="col">
          <h4>更新中预览 <span class="badge badge-info">未闭合标签</span></h4>
          <div class="preview-sandbox">
            <SandboxIframe :html="previewUpdatingHtml" :mock-data="{}" />
          </div>
        </div>
        <div class="col">
          <h4>更新完成预览 <span class="badge badge-ok">闭合标签</span></h4>
          <div class="preview-sandbox">
            <SandboxIframe :html="previewDoneHtml" :mock-data="{}" />
          </div>
        </div>
      </div>
    </div>

    <LlmChatPanel
      feature-id="regexbeautify"
      :existing-info="
        JSON.stringify({ 更新中: updatingRegex, 完成: doneRegex, 隐藏变量更新: hideRegex }, null, 2)
      "
      @result="applyLlmRegexes"
    />
  </div>
</template>

<style scoped>
.regex-block,
.hide-block,
.preview-block {
  margin-bottom: 14px;
}
.match-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(19, 25, 38, 0.6);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 14px;
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
  width: 340px;
}
.block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.block-head h3 {
  color: #fff;
  font-size: 13px;
  margin: 0;
}
.block-note {
  color: var(--text-muted);
  font-size: 11px;
  margin: 0;
}
.hide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.hide-info {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hide-desc {
  color: var(--text-dim);
  font-size: 13px;
}
.hide-regex {
  margin-top: 10px;
}
.hide-status {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.preview-block .btn {
  margin-left: auto;
}
.preview-grid {
  display: flex;
  gap: 14px;
  margin-top: 12px;
}
.col {
  flex: 1;
}
.col h4 {
  color: var(--text-muted);
  font-size: 12px;
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.col pre {
  white-space: pre-wrap;
  background: #000;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  color: var(--text-main);
  font-size: 12px;
  max-height: 260px;
  overflow-y: auto;
}
.preview-sandbox {
  height: 280px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
code {
  color: var(--accent-bright);
}
</style>
