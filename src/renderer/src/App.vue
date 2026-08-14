<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { useNavStore, type NavView } from './stores/nav'
import { useProjectStore } from './stores/project'
import Overview from './views/Overview.vue'
import OpeningsView from './views/OpeningsView.vue'
import WorldbookView from './views/WorldbookView.vue'
import RegexView from './views/RegexView.vue'
import ScriptsView from './views/ScriptsView.vue'
import SchemaView from './views/SchemaView.vue'
import StatusBarView from './views/StatusBarView.vue'
import CreateCardView from './views/CreateCardView.vue'
import BeautifyView from './views/BeautifyView.vue'
import UpdateRulesView from './views/UpdateRulesView.vue'
import AiView from './views/AiView.vue'
import LlmPromptsView from './views/LlmPromptsView.vue'
import ExportView from './views/ExportView.vue'

const nav = useNavStore()
const project = useProjectStore()

/** 视图映射：KeepAlive 缓存所有页面，切换 Nav 时保留页面状态（含进行中的 AI 请求） */
const viewComponents: Record<NavView, Component> = {
  overview: Overview,
  openings: OpeningsView,
  worldbook: WorldbookView,
  regex: RegexView,
  scripts: ScriptsView,
  schema: SchemaView,
  statusbar: StatusBarView,
  createcard: CreateCardView,
  beautify: BeautifyView,
  updaterules: UpdateRulesView,
  ai: AiView,
  llmprompts: LlmPromptsView,
  export: ExportView
}
const viewComponent = computed(() => viewComponents[nav.view] ?? Overview)

interface NavItem {
  id: NavView
  label: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: '',
    items: [{ id: 'overview', label: '功能总览' }]
  },
  {
    label: '基本设置',
    items: [
      { id: 'openings', label: '开场白' },
      { id: 'worldbook', label: '世界书' },
      { id: 'regex', label: '正则' },
      { id: 'scripts', label: '酒馆助手脚本' }
    ]
  },
  {
    label: 'MVU',
    items: [
      { id: 'schema', label: 'Schema 编辑器' },
      { id: 'statusbar', label: '状态栏' },
      { id: 'beautify', label: '变量更新美化' },
      { id: 'updaterules', label: 'MVU世界书' }
    ]
  },
  {
    label: '其他',
    items: [
      { id: 'ai', label: 'AI 接入' },
      { id: 'llmprompts', label: 'LLM 提示词' }
    ]
  }
]

onMounted(async () => {
  await project.loadConfig()
  // 恢复上次会话（含未保存的编辑）；无会话则停留在总览等待导入
  await project.restoreSession()
})
</script>

<template>
  <div class="app-shell">
    <div class="app-bg"></div>

    <aside class="nav-panel">
      <div class="nav-logo" title="MVU Maker">MVU<span class="logo-sub">Maker</span></div>

      <div class="nav-groups">
        <template v-for="(group, gi) in groups" :key="gi">
          <div class="nav-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="nav-btn"
            :class="{ active: nav.view === item.id }"
            :title="item.label"
            @mousedown.prevent="
              () => {
                console.log('[nav] mousedown go', item.id)
                nav.go(item.id)
              }
            "
          >
            <span class="dot"></span>
            <span class="nav-label">{{ item.label }}</span>
          </button>
        </template>
      </div>

      <div class="nav-footer">
        <button class="nav-export-btn" :disabled="!project.hasCard" @click="nav.go('export')">
          ⬇ 导出角色卡
        </button>
      </div>
    </aside>

    <main class="content-panel">
      <header class="top-bar">
        <span class="card-title">{{ project.cardName || '未打开卡片' }}</span>
        <span v-if="project.mvuDetected" class="badge badge-ok">已含 MVU</span>
        <span v-if="project.statusMessage" class="status-msg">{{ project.statusMessage }}</span>
        <transition name="toast">
          <div v-if="project.toast" class="toast" :class="project.toast.kind">
            {{ project.toast.text }}
          </div>
        </transition>
      </header>

      <section class="content-body">
        <KeepAlive>
          <component :is="viewComponent" />
        </KeepAlive>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  display: flex;
  height: 100vh;
  overflow: hidden;
  z-index: 1;
}

/* ---------- 侧边导航：圆点分组 + 缩进层级 ---------- */
.nav-panel {
  width: 172px;
  min-width: 172px;
  background: rgba(11, 16, 25, 0.82);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(8px);
  z-index: 1;
}
.nav-logo {
  color: var(--accent-bright);
  font-weight: 800;
  font-size: 16px;
  padding: 14px 16px 10px;
  letter-spacing: 1px;
  display: flex;
  align-items: baseline;
  gap: 2px;
}
.logo-sub {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
}
.nav-groups {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}
.nav-group-label {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 12px 6px 3px;
  text-transform: uppercase;
}
.nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 6px 8px;
  margin-left: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: all 0.12s;
}
.nav-btn .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border-strong);
  flex-shrink: 0;
}
.nav-btn:hover {
  background: #1a2233;
  color: #fff;
}
.nav-btn.active {
  background: #000;
  color: var(--accent-bright);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.nav-btn.active .dot {
  background: var(--accent);
}
.nav-footer {
  padding: 10px 10px 14px;
  border-top: 1px solid var(--border);
}
.nav-export-btn {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: #000;
  color: var(--accent-bright);
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.nav-export-btn:hover:not(:disabled) {
  box-shadow: 0 0 10px rgba(245, 166, 35, 0.25);
}
.nav-export-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---------- 右侧主面板 ---------- */
.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  z-index: 1;
}
.top-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  background: rgba(13, 18, 27, 0.85);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(8px);
}
.card-title {
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}
.status-msg {
  color: var(--text-muted);
  font-size: 12px;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast {
  position: fixed;
  top: 46px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.toast.ok {
  background: #0f2f20;
  color: #7be0a3;
  border: 1px solid #2a7a3a;
}
.toast.err {
  background: #3a1a1a;
  color: #ff8585;
  border: 1px solid #7a2a36;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}
.content-body {
  flex: 1;
  overflow: auto;
  padding: 18px;
}
</style>
