<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '../stores/project'
import NoCard from '../components/NoCard.vue'
import type { ValidationReport } from '../../../shared/types'

const project = useProjectStore()

const report = ref<ValidationReport | null>(null)
const running = ref(false)
const exporting = ref(false)
const exportMsg = ref('')

async function runValidate(): Promise<void> {
  if (!project.project) return
  running.value = true
  // 深拷贝为普通对象再发 IPC：Pinia 响应式 Proxy 无法被 structuredClone 克隆
  report.value = await window.cardTool.validateCard(JSON.parse(JSON.stringify(project.project)))
  running.value = false
}

async function doExport(): Promise<void> {
  if (!project.project) return
  exporting.value = true
  exportMsg.value = ''
  try {
    const format = project.project.card.format
    const result = await window.cardTool.exportCardWithDrafts(
      JSON.parse(JSON.stringify(project.project)),
      format,
      {
        updateRules: project.mvuDrafts.updateRules,
        outputFormat: project.mvuDrafts.outputFormat,
        variableList: project.mvuDrafts.variableList
      }
    )
    if (!result.path) {
      exportMsg.value = result.report.ok ? '已取消导出。' : '校验未通过，请先修复。'
    } else {
      exportMsg.value = `已导出: ${result.path}（新开聊天才能生效）`
      report.value = result.report
    }
  } catch (e) {
    exportMsg.value = (e as Error).message
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <NoCard v-if="!project.hasCard" />
  <div v-else class="page">
    <div class="page-head">
      <h2>导出角色卡</h2>
      <div class="actions">
        <button class="btn" :disabled="running" @click="runValidate">🛡 校验</button>
        <button class="btn btn-primary" :disabled="exporting" @click="doExport">
          {{
            exporting ? '导出中...' : `导出角色卡 (${project.project?.card.format.toUpperCase()})`
          }}
        </button>
      </div>
    </div>
    <p class="desc">导出前自动运行全部校验。源卡为 PNG 时保留原头像输出 PNG；JSON 卡输出 JSON。</p>

    <div v-if="running" class="panel hint-panel">正在校验...</div>

    <div v-if="report" class="report-panel">
      <h3>
        校验报告
        <span :class="['badge', report.ok ? 'badge-ok' : 'badge-danger']">
          {{ report.ok ? '全部通过' : `${report.checks.filter((c) => !c.passed).length} 项失败` }}
        </span>
      </h3>
      <div class="check-list">
        <div v-for="c in report.checks" :key="c.name" class="check-item">
          <span :class="['badge', c.passed ? 'badge-ok' : 'badge-danger']">{{
            c.passed ? '通过' : '失败'
          }}</span>
          <span class="check-name">{{ c.name }}</span>
          <span v-if="c.message" class="check-msg">{{ c.message }}</span>
        </div>
      </div>
    </div>

    <p v-if="exportMsg" class="export-msg">{{ exportMsg }}</p>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 10px;
}
.report-panel {
  background: rgba(19, 25, 38, 0.92);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  margin-top: 14px;
}
.report-panel h3 {
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.check-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: #161d2b;
  border-radius: 6px;
}
.check-name {
  color: var(--text-main);
  font-weight: 600;
}
.check-msg {
  color: var(--text-muted);
  font-size: 12px;
}
.export-msg {
  color: var(--accent-bright);
  font-size: 13px;
  margin-top: 12px;
}
.hint-panel {
  color: var(--text-muted);
}
</style>
