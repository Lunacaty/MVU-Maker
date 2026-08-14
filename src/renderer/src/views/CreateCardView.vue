<script setup lang="ts">
/* eslint-disable no-useless-escape */
import { ref, watch, computed } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import SandboxIframe from '../components/SandboxIframe.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import { makeCreateCardPair, PLACEHOLDER_CREATE_CARD } from '../../../shared/templates'
import { matchRegexByTarget, extractHtmlFromReplace } from '../../../shared/regex'

const project = useProjectStore()

const mockData = ref<Record<string, unknown>>({})

const createCardHtml = ref('')
const matchedReplace = ref<string>('')
const manualPick = ref<string>('')
const candidateRegexes = computed(() =>
  (project.project?.regexes ?? []).filter((r) => r.markdownOnly && !r.promptOnly && !r.disabled)
)

function loadFromCard(): void {
  if (!project.project) return
  const matched = matchRegexByTarget(project.project.regexes, PLACEHOLDER_CREATE_CARD)
  if (matched.replace) {
    matchedReplace.value = matched.replace.scriptName
    createCardHtml.value =
      extractHtmlFromReplace(matched.replace.replaceString) || createCardHtml.value
  } else matchedReplace.value = ''
}

function applyManualPick(): void {
  if (!project.project || !manualPick.value) return
  const r = project.project.regexes.find((x) => x.id === manualPick.value)
  if (r && r.replaceString) createCardHtml.value = extractHtmlFromReplace(r.replaceString)
  matchedReplace.value = r ? r.scriptName : ''
}

watch(
  () => project.project?.card.path,
  () => loadFromCard(),
  { immediate: true }
)

function injectToCard(): void {
  if (!project.project || !createCardHtml.value.trim()) return
  const list = project.project.regexes
  for (const fresh of makeCreateCardPair(createCardHtml.value)) {
    const existing = list.find((r) => r.id === manualPick.value)
    const idx = existing
      ? list.indexOf(existing)
      : list.findIndex((r) => r.scriptName === fresh.scriptName)
    if (idx >= 0) list[idx] = { ...fresh, id: list[idx].id, scriptName: list[idx].scriptName }
    else list.push(fresh)
  }
  project.statusMessage = '已注入创建卡片（对AI隐藏 + 角色创建卡片，可在「正则」页查看）'
}

function defaultTemplate(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
:root { --gold: #f5a623; --gold-bright: #ffc94d; }
body { margin: 0; background: #000; color: #fff; font-family: "Microsoft YaHei", sans-serif; }
.creator { max-width: 640px; margin: 16px auto; padding: 20px; background: rgba(13,18,32,0.9); border: 1px solid var(--gold); border-radius: 14px; box-shadow: 0 0 24px rgba(245,166,35,0.2); }
.creator h2 { color: var(--gold); margin: 0 0 14px; text-shadow: 0 0 8px rgba(245,166,35,0.5); }
.step { margin-bottom: 14px; }
.step label { display: block; color: #a9b3c3; margin-bottom: 4px; font-size: 13px; }
.step input, .step select { width: 100%; box-sizing: border-box; padding: 8px; background: #0b1019; border: 1px solid #32415f; border-radius: 6px; color: #e8ecf3; font-size: 14px; }
.opt-row { display: flex; gap: 8px; flex-wrap: wrap; }
.opt { flex: 1; min-width: 80px; padding: 9px; text-align: center; background: #0b1019; border: 1px solid #32415f; border-radius: 8px; cursor: pointer; font-size: 13px; }
.opt.sel { border-color: var(--gold); background: #3a3016; color: var(--gold-bright); }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
button { padding: 9px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-primary { background: linear-gradient(135deg, #f5a623, #d98d1f); color: #0d1320; font-weight: 700; }
.btn-ghost { background: transparent; border: 1px solid #32415f; color: #a9b3c3; }
#notice { color: var(--gold-bright); font-size: 12px; margin-top: 8px; min-height: 16px; }
</style>
</head>
<body>
<div class="creator">
  <h2>✨ 创建你的主角</h2>
  <div class="step"><label>姓名</label><input id="c-name" maxlength="16" placeholder="输入主角名"></div>
  <div class="step">
    <label>出身</label>
    <div class="opt-row" data-act="origin">
      <div class="opt" data-val="冒险者">冒险者</div>
      <div class="opt" data-val="贵族">贵族</div>
      <div class="opt" data-val="平民">平民</div>
    </div>
  </div>
  <div class="step">
    <label>偏好世界观（可多选）</label>
    <div class="opt-row" data-act="genre">
      <div class="opt" data-val="修仙">修仙</div>
      <div class="opt" data-val="西幻">西幻</div>
      <div class="opt" data-val="都市">都市</div>
      <div class="opt" data-val="末世">末世</div>
    </div>
  </div>
  <div class="actions">
    <button class="btn-ghost" id="btn-reset">重置</button>
    <button class="btn-primary" id="btn-start">开始旅程</button>
  </div>
  <div id="notice"></div>
</div>
<script type="module">
const $ = (sel) => document.querySelector(sel);
const notice = $('#notice');
const picked = { origin: '冒险者', genre: [] };
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function safe(fn){ try{fn();}catch(e){ console.error(e);} }
document.querySelector('.creator').addEventListener('click', (e) => {
  const opt = e.target.closest('[data-act] .opt');
  if (!opt) return;
  const act = opt.parentElement.dataset.act;
  if (act === 'genre') {
    opt.classList.toggle('sel');
    const v = opt.dataset.val;
    const i = picked.genre.indexOf(v);
    if (i >= 0) picked.genre.splice(i, 1); else picked.genre.push(v);
  } else {
    opt.parentElement.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
    opt.classList.add('sel');
    picked[act] = opt.dataset.val;
  }
});
$('#btn-reset').addEventListener('click', () => {
  $('#c-name').value = '';
  document.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
  picked.origin = '冒险者'; picked.genre = [];
  const first = document.querySelector('[data-act="origin"] .opt');
  if (first) first.classList.add('sel');
  notice.textContent = '';
});
$('#btn-start').addEventListener('click', async () => {
  const name = $('#c-name').value.trim();
  if (!name) { notice.textContent = '请先输入主角姓名。'; return; }
  await updateVariablesWith(vars => {
    _.set(vars, 'stat_data.主角.姓名', name);
    _.set(vars, 'stat_data.主角.出身', picked.origin);
    _.set(vars, 'stat_data.主角.偏好世界观', picked.genre);
    const log = _.get(vars, 'stat_data.系统日志', []);
    log.push('{{user}}创建了角色「' + name + '」，出身' + picked.origin);
    _.set(vars, 'stat_data.系统日志', log);
    return vars;
  }, { type: 'message', message_id: getCurrentMessageId() });
  document.querySelector('.creator').innerHTML = '<p style="color:#ffc94d;text-align:center">✅ 角色创建完成，旅途开始！</p>';
  notice.textContent = '';
});
$(errorCatched(() => { safe(() => {
  const first = document.querySelector('[data-act="origin"] .opt');
  if (first) first.classList.add('sel');
}); }));
<\/script>
</body>
</html>`
}

function loadDefault(): void {
  createCardHtml.value = defaultTemplate()
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page create-page">
    <div class="create-head">
      <h2>角色创建卡片</h2>
      <button class="btn-ghost" @click="loadDefault">加载默认模板</button>
      <button class="btn btn-primary" :disabled="!createCardHtml.trim()" @click="injectToCard">
        ⬇ 注入到当前卡
      </button>
    </div>

    <div class="match-bar">
      <span class="match-info">
        已匹配正则：<b>{{ matchedReplace || '（未找到，可手动指认或直接编辑）' }}</b>
      </span>
      <select v-model="manualPick" class="text-input pick-select" @change="applyManualPick">
        <option value="">— 手动指认一条正则作为底稿 —</option>
        <option v-for="r in candidateRegexes" :key="r.id" :value="r.id">
          {{ r.scriptName }}（{{ r.findRegex.slice(0, 40) }}）
        </option>
      </select>
    </div>

    <div class="create-body">
      <div class="sandbox-col">
        <h3>沙盒预览</h3>
        <div class="sandbox-box">
          <SandboxIframe :html="createCardHtml" :mock-data="mockData" />
        </div>
        <p class="hint">可走完「填写 → 提交 → mock 变量变化 → 收起」全流程。</p>
      </div>

      <div class="edit-col">
        <h3>HTML（完整文档结构）</h3>
        <textarea
          v-model="createCardHtml"
          class="html-area mono"
          rows="20"
          spellcheck="false"
        ></textarea>
        <LlmChatPanel
          feature-id="createcard"
          :existing-info="createCardHtml"
          @result="
            (content) => {
              const m = content
                .replace(/^```[^\n]*\n/, '')
                .replace(/```\s*$/, '')
                .trim()
              if (m) createCardHtml = m
            }
          "
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}
.create-head {
  display: flex;
  align-items: center;
  gap: 14px;
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
h3 {
  color: #d4dbe6;
  font-size: 13px;
  margin: 0 0 8px;
}
.create-body {
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
  width: 45%;
  min-width: 420px;
  overflow-y: auto;
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
.html-area {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid #32415f;
  color: #e8ecf3;
  border-radius: 8px;
  padding: 10px;
  resize: vertical;
  font-size: 12px;
  line-height: 1.5;
}
.mono {
  font-family: Consolas, monospace;
}
.btn-ghost {
  background: transparent;
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
</style>
