<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '../stores/project'
import { useNavStore } from '../stores/nav'

const project = useProjectStore()
const nav = useNavStore()

const regexCount = computed(() => project.project?.regexes.length ?? 0)
const entryCount = computed(() => project.project?.worldbookEntries.length ?? 0)
const scriptCount = computed(() => Object.keys(project.project?.scripts ?? {}).length ?? 0)
const openingCount = computed(() => project.project?.openings.length ?? 0)

const injectedFeatures = computed(() => {
  if (!project.project) return []
  const regexNames = project.project.regexes.map((r) => r.scriptName)
  const scriptContents = Object.values(project.project.scripts).map((s) => s.content ?? '')
  const scriptNames = Object.keys(project.project.scripts)
  // MVU 脚本 / Zod 脚本：导入时自动检测酒馆助手脚本内容
  const hasMvuScript =
    scriptContents.some((c) => c.includes('MagVarUpdate')) || scriptNames.includes('MVU')
  const hasZodScript =
    scriptContents.some((c) => /export\s+const\s+Schema|registerMvuSchema|z\.object/i.test(c)) ||
    scriptNames.includes('Zod')
  // 变量更新世界书：检测 [mvu_update] 输出格式/更新规则 + 变量列表（前缀不分大小写）
  const wbLower = project.project.worldbookEntries.map((e) => e.comment.toLowerCase())
  const hasUpdateWorldbook =
    wbLower.includes('[mvu_update]变量输出格式') &&
    wbLower.includes('[mvu_update]变量更新规则') &&
    wbLower.includes('变量列表')
  // 初始变量世界书：名称/关键词含 [InitVar]（前缀不分大小写）
  const hasInitvarWorldbook = project.project.worldbookEntries.some(
    (e) =>
      e.comment.toLowerCase().includes('[initvar]') ||
      e.keys.some((k) => k.toLowerCase().includes('[initvar]'))
  )
  return [
    { name: 'MVU 变量系统', on: hasMvuScript, tag: '必填' },
    { name: 'Schema 结构', on: hasZodScript, tag: '必填' },
    {
      name: '状态栏',
      on: project.statusBarMatched || regexNames.includes('状态栏界面'),
      tag: '可选'
    },
    { name: '变量更新世界书', on: hasUpdateWorldbook, tag: '可选' },
    { name: '初始变量世界书', on: hasInitvarWorldbook, tag: '可选' }
  ]
})

// 功能说明卡片（总览引导）
const featureCards = [
  {
    icon: '🧬',
    title: 'Schema 编辑器',
    desc: '在平面画布上从空对象 {} 起搭建 MVU 变量结构：字段增删、副对象拼接/拆下、复制粘贴，自动生成 zod 代码。',
    action: 'schema'
  },
  {
    icon: '📊',
    title: '状态栏',
    desc: '注入消息楼层内渲染的角色状态面板（纯原生 JS，完整 HTML），内置主题，实时沙盒预览。',
    action: 'statusbar'
  },
  {
    icon: '🎭',
    title: '创建卡片',
    desc: '开局捏人向导：玩家填写姓名/出身/偏好等，提交后写入 stat_data，触发 AI 开局。',
    action: 'createcard'
  },
  {
    icon: '🧩',
    title: '酒馆助手脚本',
    desc: '管理卡内酒馆助手脚本（MVU/Zod 自动脚本、第三方脚本），启停与内容编辑。',
    action: 'scripts'
  },
  {
    icon: '📜',
    title: '开场白',
    desc: '支持多条开场白；每条可选纯文字 / 纯创建卡片 / 混合，并可附加各自的 initvar 初始变量。',
    action: 'openings'
  },
  {
    icon: '📚',
    title: '世界书',
    desc: '条目增删改查、蓝灯/绿灯切换、关键词/位置/深度编辑，可用 LLM 从零设计或增量改写。',
    action: 'worldbook'
  },
  {
    icon: '🔍',
    title: '正则',
    desc: '管理卡内全部正则：变量更新美化五件套、占位符替换，支持顺序调整与实时测试。',
    action: 'regex'
  },
  {
    icon: '🤖',
    title: 'LLM 辅助',
    desc: '世界书/Schema/状态栏/创建卡片/美化正则/更新规则均可由 AI 生成，内置领域知识注入提示词。',
    action: 'ai'
  }
]
</script>

<template>
  <div class="page">
    <!-- 欢迎区 -->
    <div class="hero">
      <div class="hero-text">
        <h1>MVU Maker</h1>
        <p class="hero-sub">给已完成的纯文字角色卡一键增强 MVU 变量、状态栏与角色创建卡片</p>
      </div>

      <button
        class="btn btn-primary btn-lg"
        :disabled="project.loading"
        @click="project.openCard()"
      >
        {{ project.loading ? '打开中...' : '📥 导入角色卡 (PNG / JSON)' }}
      </button>
    </div>

    <!-- 使用流程 -->
    <div class="steps">
      <div class="step">
        <span class="step-num">1</span>
        <div><b>导入卡片</b><small>支持 PNG（含头像）与 JSON 角色卡，自动识别 MVU 结构</small></div>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <div><b>配置 Schema</b><small>画布搭建变量结构 → 生成 initvar 与更新规则</small></div>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <div><b>注入组件</b><small>状态栏 / 创建卡片 / 开场白 initvar override</small></div>
      </div>
      <div class="step">
        <span class="step-num">4</span>
        <div><b>校验导出</b><small>自动检查结构与一致性，导出 PNG 或 JSON</small></div>
      </div>
    </div>

    <!-- 已导入卡片信息 -->
    <template v-if="project.hasCard">
      <div class="panel card-info">
        <h3>当前卡片</h3>
        <div class="info-row">
          <span class="label">角色名</span>
          <span class="value">{{ project.project?.card.json.data.name }}</span>
        </div>
        <div class="info-row">
          <span class="label">来源</span>
          <span class="value mono">{{ project.project?.card.path }}</span>
        </div>
        <div class="info-grid">
          <div class="stat">
            <b>{{ openingCount }}</b
            ><span>开场白</span>
          </div>
          <div class="stat">
            <b>{{ entryCount }}</b
            ><span>世界书条目</span>
          </div>
          <div class="stat">
            <b>{{ regexCount }}</b
            ><span>正则</span>
          </div>
          <div class="stat">
            <b>{{ scriptCount }}</b
            ><span>脚本</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>已注入功能</h3>
        <div class="feature-list">
          <div v-for="f in injectedFeatures" :key="f.name" class="feature-item">
            <span :class="['badge', f.on ? 'badge-ok' : 'badge-danger']">{{
              f.on ? '已启用' : '未注入'
            }}</span>
            <span class="feature-name">{{ f.name }}</span>
            <span class="badge badge-info">{{ f.tag }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 功能总览卡片 -->
    <div class="feature-grid">
      <button
        v-for="c in featureCards"
        :key="c.title"
        class="feature-card"
        @click="nav.go(c.action as never)"
      >
        <span class="fc-icon">{{ c.icon }}</span>
        <span class="fc-title">{{ c.title }}</span>
        <span class="fc-desc">{{ c.desc }}</span>
      </button>
    </div>

    <!-- 使用前提 -->
    <div class="panel notice">
      <h3>使用前提</h3>
      <ul>
        <li>需要酒馆助手（Tavern-Helper）扩展</li>
        <li>MVU 仅聊天补全模式工作</li>
        <li>导入后必须新开聊天（schema 变更不生效于旧聊天）</li>
        <li>PNG 导出保留原头像；JSON 卡导出 JSON</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  margin-bottom: 16px;
  background: rgba(19, 25, 38, 0.9);
  border: 1px solid var(--border);
  border-radius: 12px;
  backdrop-filter: blur(6px);
}
.hero h1 {
  color: #fff;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 1px;
}
.hero-sub {
  color: var(--text-muted);
  font-size: 13px;
  margin-top: 2px;
}
.btn-lg {
  padding: 10px 22px;
  font-size: 14px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.step {
  display: flex;
  gap: 10px;
  background: rgba(19, 25, 38, 0.9);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  align-items: flex-start;
}
.step-num {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #000;
  border: 1px solid var(--accent);
  color: var(--accent-bright);
  font-weight: 800;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step b {
  display: block;
  color: #fff;
  font-size: 13px;
}
.step small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
  display: block;
  margin-top: 2px;
}

.card-info {
  margin-bottom: 16px;
}
.info-row {
  display: flex;
  gap: 10px;
  padding: 3px 0;
}
.info-row .label {
  color: var(--text-muted);
  min-width: 64px;
}
.info-row .value {
  color: var(--text-main);
  word-break: break-all;
}
.info-grid {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.stat {
  flex: 1;
  text-align: center;
  background: #0b1019;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.stat b {
  display: block;
  color: var(--accent-bright);
  font-size: 20px;
}
.stat span {
  color: var(--text-muted);
  font-size: 11px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.feature-name {
  color: var(--text-main);
  flex: 1;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.feature-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 6px;
  background: rgba(19, 25, 38, 0.9);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.feature-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.fc-icon {
  font-size: 22px;
}
.fc-title {
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}
.fc-desc {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.notice {
  margin-bottom: 12px;
}
.notice ul {
  list-style: none;
  padding: 0;
}
.notice li {
  color: var(--text-dim);
  font-size: 12px;
  padding: 2px 0;
}
.notice li::before {
  content: '› ';
  color: var(--accent);
}
</style>
