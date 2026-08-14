<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'
import { canvasToInitvarYaml } from '../../../shared/schema'

const project = useProjectStore()

// 三份草稿与初始变量都来自 store（开卡时从卡片世界书条目载入）
const updateRules = computed({
  get: () => project.mvuDrafts.updateRules,
  set: (v: string) => {
    project.mvuDrafts.updateRules = v
  }
})
const outputFormat = computed({
  get: () => project.mvuDrafts.outputFormat,
  set: (v: string) => {
    project.mvuDrafts.outputFormat = v
  }
})
const variableList = computed({
  get: () => project.mvuDrafts.variableList,
  set: (v: string) => {
    project.mvuDrafts.variableList = v
  }
})
const initvarContent = computed(() => project.initvarContent)

function applyLlmRules(content: string): void {
  const text = content
    .replace(/^```[^\n]*\n/g, '')
    .replace(/```\s*$/g, '')
    .trim()
  if (!text) return
  // LLM 输出两份：① 变量更新规则（以 "变量更新规则:" 开头）② 变量输出格式（以 <update_variable_rules> 开头）
  const rulesIdx = text.indexOf('变量更新规则:')
  const formatIdx = text.indexOf('<update_variable_rules>')
  if (rulesIdx >= 0 && formatIdx >= 0) {
    updateRules.value = text.slice(rulesIdx, formatIdx).trim()
    outputFormat.value = text.slice(formatIdx).trim()
  } else if (rulesIdx >= 0) {
    updateRules.value = text.slice(rulesIdx).trim()
  } else if (formatIdx >= 0) {
    outputFormat.value = text.slice(formatIdx).trim()
  } else if (text) {
    updateRules.value = text
  }
}

/** 把草稿注入当前项目的世界书条目（立即生效，可在「世界书」页查看）：
 * 注入 3 条 MVU 提示词条目，并**自动注入 [InitVar] 初始变量条目**——
 * 内容按 Schema 结构生成的全默认空值（string→''、number→0、boolean→false、enum→首值、object→递归、record→{}），不需要 LLM。
 */
function injectToWorldbook(): void {
  if (!project.project) return
  const entries = project.project.worldbookEntries
  const upsert = (
    comment: string,
    content: string,
    opts: { order?: number; depth?: number; enabled?: boolean } = {}
  ): void => {
    const lower = comment.toLowerCase()
    const existing = entries.find((e) => e.comment.toLowerCase() === lower)
    const order = opts.order ?? 200
    const depth = opts.depth ?? 0
    const enabled = opts.enabled ?? true
    if (existing) {
      existing.content = content
      existing.constant = true
      existing.enabled = enabled
      existing.position = '@D'
      existing.extensions.position = 4 // at_depth（@D），不是 6（EMBottom）
      existing.extensions.order = order
      existing.extensions.depth = depth
    } else {
      const maxId = entries.reduce((m, e) => Math.max(m, Number(e.id) || 0), -1) + 1
      entries.push({
        keys: [],
        secondary_keys: [],
        comment,
        content,
        constant: true,
        selective: false,
        insertion_order: order,
        enabled,
        position: '@D',
        extensions: { position: 4, depth, role: 0, order, display_index: 0 },
        id: maxId
      })
    }
  }
  upsert('[mvu_update]变量更新规则', project.mvuDrafts.updateRules, { order: 200, depth: 0 })
  upsert('[mvu_update]变量输出格式', project.mvuDrafts.outputFormat, { order: 200, depth: 4 })
  upsert('变量列表', project.mvuDrafts.variableList, { order: 200, depth: 0 })
  upsert('[InitVar]请勿打开', canvasToInitvarYaml(project.project.schemaCanvas), {
    order: 200,
    depth: 4,
    enabled: false // 三铁律：[InitVar] 必须禁用
  })
  project.showToast('已注入 MVU 世界书条目（含 [InitVar] 初始变量，Schema 默认空值）')
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>MVU 世界书</h2>
      <button class="btn btn-primary" @click="injectToWorldbook">⬇ 注入到世界书</button>
    </div>
    <p class="desc">
      这是 MVU
      三大提示词世界书条目（写入角色卡世界书）。导入卡片时自动载入卡内既有内容；编辑完成后点
      「注入到世界书」立即写入当前项目（含自动生成的
      <code>[InitVar]</code>
      初始变量条目，可在「世界书」页查看），导出时随卡写入；「变量列表」恒用程序默认值覆盖。
    </p>

    <div class="section">
      <h3>变量列表（蓝灯 @D0，含数据权威声明；导出时恒用程序默认值覆盖）</h3>
      <textarea
        v-model="variableList"
        class="text-area mono"
        rows="10"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="section">
      <h3>变量更新规则</h3>
      <textarea
        v-model="updateRules"
        class="text-area mono"
        rows="12"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="section">
      <h3>变量输出格式（<code>&lt;UpdateVariable&gt;</code> 命令规范）</h3>
      <textarea
        v-model="outputFormat"
        class="text-area mono"
        rows="16"
        spellcheck="false"
      ></textarea>
    </div>

    <div class="section initvar-section">
      <h3>初始变量（<code>[InitVar]</code> 世界书条目，禁用，只读展示）</h3>
      <pre v-if="initvarContent" class="initvar-view">{{ initvarContent }}</pre>
      <p v-else class="empty-initvar">
        卡内暂无 <code>[InitVar]</code> 条目——点「注入到世界书」时按 Schema 结构自动生成
        <b>默认空值</b
        >（string→''、number→0、boolean→false、enum→首值、object→递归、record→{}），无需 LLM。
      </p>
    </div>

    <p class="hint">导出时若未勾选「加 MVU」，需在世界书中手工启用以上条目。</p>

    <LlmChatPanel feature-id="updaterules" show-worldbook-select @result="applyLlmRules" />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
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
.desc {
  color: #79869a;
  font-size: 13px;
  margin-bottom: 16px;
}
code {
  color: #ffc94d;
}
.section {
  background: #131926;
  border: 1px solid #25304a;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
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
.initvar-view {
  white-space: pre-wrap;
  background: #0b1019;
  border: 1px solid #32415f;
  border-radius: 8px;
  padding: 10px;
  color: #e8ecf3;
  font-family: Consolas, monospace;
  font-size: 12px;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
}
.empty-initvar {
  color: #79869a;
  font-size: 12px;
}
.hint {
  color: #79869a;
  font-size: 12px;
}
</style>
