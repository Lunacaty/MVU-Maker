import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { CardProject, ToolConfig } from '../../../shared/types'
import { createEmptyCanvas } from '../../../shared/schema'
import {
  updateRulesTemplate,
  outputFormatTemplate,
  variableListTemplate
} from '../../../shared/templates'

export const useProjectStore = defineStore('project', () => {
  const project = ref<CardProject | null>(null)
  const config = ref<ToolConfig | null>(null)
  const loading = ref(false)
  const statusMessage = ref('')
  const toast = ref<{ text: string; kind: 'ok' | 'err'; id: number } | null>(null)
  let toastId = 0

  const hasCard = computed(() => project.value !== null)
  const cardName = computed(() => project.value?.card.json.data.name ?? '')
  const mvuDetected = computed(() => project.value?.mvuDetected ?? false)

  /** 状态栏在「状态栏」页匹配到/手动指认后置为 true（功能总览据此显示已注入） */
  const statusBarMatched = ref(false)

  /** 「MVU世界书」页三份草稿：开卡时从卡片世界书条目载入；变量列表恒为程序默认值 */
  const mvuDrafts = ref<{ updateRules: string; outputFormat: string; variableList: string }>({
    updateRules: updateRulesTemplate(),
    outputFormat: outputFormatTemplate(),
    variableList: variableListTemplate()
  })

  // ---------- 会话持久化：工作项目自动落盘，重启后恢复（避免丢失未导出的编辑） ----------
  let sessionTimer: ReturnType<typeof setTimeout> | null = null
  function persistSession(): void {
    if (sessionTimer) clearTimeout(sessionTimer)
    sessionTimer = setTimeout(() => {
      if (!project.value) return
      // 深拷贝为普通对象再走 IPC（Pinia 响应式 Proxy 无法被 structuredClone 克隆）
      window.cardTool.saveSessionProject(JSON.parse(JSON.stringify(project.value))).catch(() => {})
    }, 800)
  }
  watch(
    () => project.value,
    () => persistSession(),
    { deep: true }
  )

  /** 启动时尝试恢复上次会话（含未保存的编辑）；恢复成功返回 true */
  async function restoreSession(): Promise<boolean> {
    try {
      const saved = await window.cardTool.loadSessionProject()
      if (!saved) return false
      project.value = saved
      statusBarMatched.value = false
      initMvuDrafts()
      statusMessage.value = `已恢复上次会话: ${saved.card.path}`
      return true
    } catch {
      return false
    }
  }

  /** 初始变量条目内容（[InitVar] 世界书条目，只读展示；前缀不分大小写） */
  const initvarContent = computed(() => {
    const entries = project.value?.worldbookEntries ?? []
    const e = entries.find(
      (x) =>
        x.comment.toLowerCase().includes('[initvar]') ||
        x.keys.some((k) => k.toLowerCase().includes('[initvar]'))
    )
    return e?.content ?? ''
  })

  function initMvuDrafts(): void {
    if (!project.value) return
    const entries = project.value.worldbookEntries
    const find = (comment: string): string | undefined => {
      const lower = comment.toLowerCase()
      return entries.find((e) => e.comment.toLowerCase() === lower)?.content
    }
    mvuDrafts.value = {
      updateRules: find('[mvu_update]变量更新规则') || updateRulesTemplate(),
      outputFormat: find('[mvu_update]变量输出格式') || outputFormatTemplate(),
      variableList: variableListTemplate()
    }
  }

  /** 顶部气泡提示（几秒后消失） */
  function showToast(text: string, kind: 'ok' | 'err' = 'ok'): void {
    toast.value = { text, kind, id: ++toastId }
    setTimeout(() => {
      if (toast.value?.id === toastId) toast.value = null
    }, 3000)
  }

  async function loadConfig(): Promise<void> {
    config.value = await window.cardTool.getConfig()
  }

  async function openCard(): Promise<boolean> {
    loading.value = true
    statusMessage.value = ''
    try {
      const result = await window.cardTool.openCard()
      if (!result) {
        loading.value = false
        return false
      }
      project.value = {
        card: { path: result.path, format: result.format, json: result.json },
        schemaCanvas: createEmptyCanvas(),
        openings: [],
        regexes: [],
        worldbookEntries: [],
        scripts: {},
        mvuDetected: false
      }
      // 从主进程取完整会话项目（含 schema 反推 / 开场白 / 世界书 / 正则 / 脚本）
      const full = await window.cardTool.loadProject()
      if (full) project.value = full
      statusBarMatched.value = false
      initMvuDrafts()
      statusMessage.value = `已打开: ${result.path}`
      loading.value = false
      return true
    } catch (e) {
      statusMessage.value = (e as Error).message
      loading.value = false
      return false
    }
  }

  function setProject(p: CardProject | null): void {
    project.value = p
  }

  return {
    project,
    config,
    loading,
    statusMessage,
    toast,
    showToast,
    hasCard,
    cardName,
    mvuDetected,
    statusBarMatched,
    mvuDrafts,
    initvarContent,
    loadConfig,
    openCard,
    restoreSession,
    setProject
  }
})
