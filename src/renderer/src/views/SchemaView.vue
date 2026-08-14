<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import type { Node as FlowNode, Edge as FlowEdge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { useProjectStore } from '../stores/project'
import {
  newId,
  getNode,
  ROOT_NODE_ID,
  zodToCanvas,
  canvasToZodCode,
  extractSchemaExprFromScript,
  isContainer,
  canHaveChildren,
  containerSlots,
  slotSegment,
  memberPosition,
  relayoutTree,
  collectSubtree,
  SNAP_RADIUS,
  CONTAINER_SIZE
} from '../../../shared/schema'
import { makeMvuScript, makeZodScript } from '../../../shared/templates'
import type { SchemaCanvas, SchemaNode } from '../../../shared/types'
import type { ContainerSlot } from '../../../shared/schema'
import SchemaCircle from '../components/SchemaCircle.vue'
import TreeEdge from '../components/TreeEdge.vue'
import FieldInspector from '../components/FieldInspector.vue'
import LlmChatPanel from '../components/LlmChatPanel.vue'

const project = useProjectStore()
const { fitView, screenToFlowCoordinate } = useVueFlow()

// 自定义边类型：水平树状正交路径
const edgeTypes = { tree: TreeEdge }

const selectedId = ref<string | null>(null)

// ---------- 撤销 / 重做（最多 20 条历史） ----------

const MAX_HISTORY = 20
const history: SchemaCanvas[] = []
const historyIndex = ref(-1)

function snapshot(): SchemaCanvas {
  return JSON.parse(JSON.stringify(project.project!.schemaCanvas)) as SchemaCanvas
}

/** 在结构性修改前调用：把当前状态压栈 */
function pushHistory(): void {
  if (!project.project) return
  history.length = historyIndex.value + 1 // 丢弃 redo 分支
  history.push(snapshot())
  if (history.length > MAX_HISTORY) history.shift()
  historyIndex.value = history.length - 1
}

function undo(): void {
  if (!project.project || historyIndex.value <= 0) return
  historyIndex.value--
  project.project.schemaCanvas = JSON.parse(
    JSON.stringify(history[historyIndex.value])
  ) as SchemaCanvas
  selectedId.value = null
}

function redo(): void {
  if (!project.project || historyIndex.value >= history.length - 1) return
  historyIndex.value++
  project.project.schemaCanvas = JSON.parse(
    JSON.stringify(history[historyIndex.value])
  ) as SchemaCanvas
  selectedId.value = null
}

// 监听画布被替换（loadFromScript/undo/redo）时重建历史基线
watch(
  () => project.project?.schemaCanvas,
  () => {
    if (project.project && historyIndex.value === -1) {
      history.length = 0
      history.push(snapshot())
      historyIndex.value = 0
    }
  },
  { immediate: true, deep: false }
)

// ---------- 节点 / 边 ----------

const flowNodes = computed<FlowNode[]>(() => {
  if (!project.project) return []
  const canvas = project.project.schemaCanvas
  const nodes: FlowNode[] = canvas.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: { node: n },
    type: 'schemaNode',
    class: n.id === dragNodeId.value ? 'node-dragging' : '',
    // 所有节点都可拖：拖动任意节点 = 整个结构一起移动
    draggable: true
  }))
  // 虚拟节点：每个容器的"第 N+1 个成员"，作为空闲虚线的目标锚点
  for (const c of canvas.nodes) {
    if (!canHaveChildren(c)) continue
    const free = containerSlots(canvas, c.id).find((s) => s.childId === null)
    if (!free) continue
    nodes.push({
      id: `vf-${c.id}`,
      position: memberPosition(canvas, c, free),
      data: { node: null, virtual: true },
      type: 'schemaNode',
      draggable: false
    })
  }
  return nodes
})

const flowEdges = computed<FlowEdge[]>(() => {
  if (!project.project) return []
  const canvas = project.project.schemaCanvas
  const edges: FlowEdge[] = []
  for (const n of canvas.nodes) {
    if (!n.parentId || n.parentId === n.id) continue
    const slot = containerSlots(canvas, n.parentId).find((s) => s.childId === n.id)
    const parent = getNode(canvas, n.parentId)
    const color = parent ? typeColor(parent) : '#f5a623'
    edges.push({
      id: `e-${n.parentId}-${n.id}`,
      source: n.parentId,
      target: n.id,
      sourceHandle: slot ? `slot-${n.id}` : undefined,
      type: 'tree',
      data: { color }
    })
  }
  // 空闲虚线边：容器 → 虚拟节点（第 N+1 个成员），虚线样式，几何与实线完全一致
  for (const c of canvas.nodes) {
    if (!canHaveChildren(c)) continue
    const free = containerSlots(canvas, c.id).find((s) => s.childId === null)
    if (!free) continue
    edges.push({
      id: `e-free-${c.id}`,
      source: c.id,
      target: `vf-${c.id}`,
      sourceHandle: 'slot-free',
      type: 'tree',
      data: {
        color: typeColor(c),
        dashed: true,
        highlight: previewSlot.value?.containerId === c.id
      }
    })
  }
  return edges
})

function typeColor(node: SchemaNode): string {
  switch (node.type) {
    case 'string':
      return '#58a6ff'
    case 'number':
      return '#3ddc84'
    case 'boolean':
      return '#ffb020'
    case 'enum':
      return '#c678dd'
    case 'record':
    case 'object':
      return '#f5a623'
    case 'union':
      return '#56d4dd'
    default:
      return '#f5a623'
  }
}

/** nodeId 是否在 selectedId 的子树内（选中容器 → 整个对象高亮） */
function isInSubtree(nodeId: string, selectedId: string): boolean {
  if (!project.project) return false
  if (nodeId === selectedId) return true
  const sub = collectSubtree(project.project.schemaCanvas, selectedId)
  return sub.includes(nodeId)
}

function nodeCenter(node: SchemaNode): { x: number; y: number } {
  return { x: node.position.x + CONTAINER_SIZE / 2, y: node.position.y + CONTAINER_SIZE / 2 }
}

/** 点到线段的最短距离 */
function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function locateRoot(): void {
  fitView({ nodes: [ROOT_NODE_ID], padding: 0.5, duration: 300 })
}

// ---------- 从酒馆助手脚本加载 Schema ----------

const scriptPick = ref('')
/** 当前画布最后一次是从哪个脚本加载的（一键导入时优先回写该脚本） */
const loadedScriptKey = ref('')
const zodScripts = computed(() => {
  if (!project.project) return []
  return Object.entries(project.project.scripts).filter(([, s]) =>
    /export\s+const\s+Schema|registerMvuSchema|z\.object/i.test(s.content)
  )
})

/** 脚本可读名：key 是数字/UUID 时从内容推导 */
function scriptDisplayName(key: string, content: string): string {
  const isPlainName =
    !/^\d+$/.test(key) && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)
  if (isPlainName) return key
  const m = content.match(/export\s+const\s+Schema\s*=\s*z\.object\(\s*\{\s*([^}]+)/)
  if (m) {
    const firstName = m[1].match(/["']([^"']+)["']\s*:/)
    if (firstName) return `Zod（含 ${firstName[1]} 等）`
    return 'Zod 脚本'
  }
  if (content.includes('MagVarUpdate')) return 'MVU'
  return '脚本 ' + key.slice(0, 8)
}

function loadFromScript(): void {
  if (!project.project || !scriptPick.value) return
  const script = project.project.scripts[scriptPick.value]
  if (!script) return
  const expr = extractSchemaExprFromScript(script.content)
  if (!expr) {
    project.statusMessage = '该脚本中未找到可解析的 export const Schema'
    return
  }
  try {
    pushHistory()
    project.project.schemaCanvas = zodToCanvas(expr)
    loadedScriptKey.value = scriptPick.value
    project.statusMessage = `已从脚本「${scriptPick.value}」加载 Schema，可直接编辑`
    fitView({ padding: 0.3, duration: 300 })
  } catch {
    project.statusMessage = 'Schema 解析失败，脚本内容可能不标准'
  }
}

/**
 * 一键导入：把当前画布生成完整 Zod 脚本写入卡内酒馆助手脚本。
 * 若画布是从某个脚本加载的 → 更新该脚本；否则按当前数据新建完整 Zod 脚本（Zod）。
 */
function importToScript(): void {
  if (!project.project) return
  const code = canvasToZodCode(project.project.schemaCanvas)
  const fresh = makeZodScript(code)
  // 优先回写"来源脚本"；否则 upsert 'Zod'
  const targetKey =
    loadedScriptKey.value && project.project.scripts[loadedScriptKey.value]
      ? loadedScriptKey.value
      : 'Zod'
  if (project.project.scripts[targetKey]) {
    project.project.scripts[targetKey].content = fresh.content
    project.showToast(`已更新脚本「${targetKey}」为当前 Schema`)
  } else {
    project.project.scripts[targetKey] = fresh
    project.showToast(`已新建完整 Zod 脚本「${targetKey}」`)
  }
  // 检查 MVU 脚本：没有则一并写入（Zod 依赖 MVU 运行时）
  const hasMvu = Object.entries(project.project.scripts).some(
    ([k, s]) => k === 'MVU' || (s.content ?? '').includes('MagVarUpdate')
  )
  if (!hasMvu) {
    project.project.scripts['MVU'] = makeMvuScript()
    project.showToast('已一并写入 MVU 脚本（Zod 依赖 MVU 运行时）')
  }
}

// ---------- 右键菜单体系 ----------

type MenuKind = 'radial' | 'member' | 'global'
const menu = ref<{ kind: MenuKind; px: number; py: number; visible: boolean }>({
  kind: 'radial',
  px: 0,
  py: 0,
  visible: false
})
const memberMenuTarget = ref<string | null>(null) // 成员菜单作用的节点 id
const hoverType = ref<string | null>(null)
const holding = ref(false)
const menuFlowPoint = ref<{ x: number; y: number }>({ x: 0, y: 0 })

const TYPE_LIST: { type: Exclude<SchemaNode['type'], 'root'>; label: string; color: string }[] = [
  { type: 'string', label: '文本', color: '#58a6ff' },
  { type: 'number', label: '数值', color: '#3ddc84' },
  { type: 'boolean', label: '布尔', color: '#ffb020' },
  { type: 'enum', label: '枚举', color: '#c678dd' },
  { type: 'record', label: '记录', color: '#f5a623' },
  { type: 'object', label: '对象', color: '#f5a623' },
  { type: 'union', label: '联合', color: '#56d4dd' }
]

const RADIUS = 96

function canvasRect(): DOMRect | null {
  const el = document.querySelector('.canvas-wrap .vue-flow') as HTMLElement | null
  return el?.getBoundingClientRect() ?? null
}

function toFlow(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvasRect()
  if (!rect) return { x: clientX, y: clientY }
  return screenToFlowCoordinate({ x: clientX - rect.left, y: clientY - rect.top })
}

/** 右键按下即打开菜单（支持按住拖动选类型），contextmenu 只阻止浏览器默认菜单，不重复打开 */
function canvasMousedown(e: MouseEvent): void {
  if (e.button !== 2) return
  openContextMenu(e)
  e.preventDefault()
}

/** contextmenu 只阻止浏览器默认菜单；打开逻辑完全由 mousedown 负责 */
function canvasContextmenu(e: MouseEvent): void {
  e.preventDefault()
}

function openContextMenu(e: MouseEvent): void {
  console.log(
    '[ctxmenu] 触发，shift=',
    e.shiftKey,
    'target=',
    (e.target as HTMLElement).className,
    'visible=',
    menu.value.visible
  )
  const rect = canvasRect()
  if (!rect) return
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  menuFlowPoint.value = toFlow(e.clientX, e.clientY)

  if (e.shiftKey) {
    menu.value = { kind: 'global', px, py, visible: true }
    console.log('[ctxmenu] 打开全局菜单')
    return
  }

  // 判断是否点在成员节点上（选中态成员优先）
  const hitEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
  const hitId = hitEl?.dataset.nodeId ?? null
  console.log('[ctxmenu] hitId=', hitId)
  if (hitId && hitId !== ROOT_NODE_ID) {
    selectedId.value = hitId
    memberMenuTarget.value = hitId
    menu.value = { kind: 'member', px, py, visible: true }
    console.log('[ctxmenu] 打开成员菜单，target=', hitId)
    return
  }

  // 普通右键 = 环形新建游离字段
  menu.value = { kind: 'radial', px, py, visible: true }
  holding.value = true
  console.log('[ctxmenu] 打开环形菜单')
}

// 环形菜单项像素位置
function radialItemPosPx(i: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (2 * Math.PI * i) / TYPE_LIST.length
  return {
    x: menu.value.px + RADIUS * Math.cos(angle),
    y: menu.value.py + RADIUS * Math.sin(angle)
  }
}

function onMenuMove(e: MouseEvent): void {
  // 始终记录最近鼠标流坐标（供 Ctrl+V 粘贴）
  const rect = canvasRect()
  if (rect) lastMouseFlow.value = toFlow(e.clientX, e.clientY)
  if (menu.value.kind !== 'radial') return
  if (!rect) return
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  let hit: string | null = null
  for (let i = 0; i < TYPE_LIST.length; i++) {
    const p = radialItemPosPx(i)
    if (Math.hypot(px - p.x, py - p.y) < 30) {
      hit = TYPE_LIST[i].type
      break
    }
  }
  hoverType.value = hit
}

function onMenuUp(e: MouseEvent): void {
  console.log('[menuup] holding=', holding.value, 'kind=', menu.value.kind, 'button=', e.button)
  if (!holding.value || menu.value.kind !== 'radial') return
  holding.value = false
  const rect = canvasRect()
  if (rect) {
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    for (let i = 0; i < TYPE_LIST.length; i++) {
      const p = radialItemPosPx(i)
      if (Math.hypot(px - p.x, py - p.y) < 34) {
        createNodeAt(TYPE_LIST[i].type)
        break
      }
    }
  }
  menu.value.visible = false
  hoverType.value = null
  console.log('[menuup] 菜单已关闭')
}

function closeMenu(): void {
  menu.value.visible = false
  holding.value = false
  hoverType.value = null
  memberMenuTarget.value = null
}

function locateAndClose(): void {
  locateRoot()
  closeMenu()
}
function undoThenClose(): void {
  undo()
  closeMenu()
}
function redoThenClose(): void {
  redo()
  closeMenu()
}

function createNodeAt(type: Exclude<SchemaNode['type'], 'root'>): void {
  if (!project.project) return
  pushHistory()
  project.project.schemaCanvas.nodes.push({
    id: newId('f'),
    name: '',
    type,
    parentId: null,
    position: { x: menuFlowPoint.value.x, y: menuFlowPoint.value.y }
  })
  closeMenu()
}

// ---------- 拼接（拖到空闲虚线） ----------

/** 把游离节点拼到某容器：先放到空闲虚线槽位位置，再设置 parentId，并按子树跨度重排容器 */
function attachTo(container: SchemaNode, node: SchemaNode): void {
  const canvas = project.project!.schemaCanvas
  // 拼接到空闲虚线槽位（其 yOffset 已由 containerSlots 算出 = 最下方成员之下）
  const free = containerSlots(canvas, container.id).find((s) => s.childId === null)
  if (free) {
    const pos = memberPosition(canvas, container, free)
    const dx = pos.x - node.position.x
    const dy = pos.y - node.position.y
    node.position = pos
    // 若成员本身是容器，把其子树整体移到成员附近（相对偏移不变）
    for (const sid of collectSubtree(canvas, node.id).filter((id) => id !== node.id)) {
      const sn = getNode(canvas, sid)
      if (sn) {
        sn.position.x += dx
        sn.position.y += dy
      }
    }
  }
  node.parentId = container.id
  // 结构变化 → 整树重排（祖先容器的槽位按新子树跨度重新计算，避免重叠）
  relayoutTree(canvas)
}

/**
 * 返回与给定节点同处一棵连通结构的全部节点 id（含自身）。
 * 树上节点 = 整棵树（含根）；游离节点 = 仅它自己的子树。
 */
function connectedSet(node: SchemaNode): Set<string> {
  const canvas = project.project!.schemaCanvas
  if (node.id === ROOT_NODE_ID || node.parentId) {
    return new Set(collectSubtree(canvas, ROOT_NODE_ID))
  }
  return new Set(collectSubtree(canvas, node.id))
}

/**
 * 拖动任意节点 → 整个结构一起移动（相对位置与连接线不变）。
 * vue-flow 已移动被拖节点，这里把同结构其他节点按 delta 同步平移。
 */
let dragStartPos: { x: number; y: number } | null = null

// 拖拽连接预览：拖游离节点靠近某容器空闲虚线时，高亮该容器的虚线槽位
const previewSlot = ref<{ containerId: string; slot: ContainerSlot } | null>(null)
const dragNodeId = ref<string | null>(null)

// 拖拽起始时各结构节点的原始位置（id → pos）
const dragOrig = new Map<string, { x: number; y: number }>()

function onNodeDrag(event: { node: FlowNode; nodes: FlowNode[] }): void {
  if (!project.project) return
  const canvas = project.project.schemaCanvas
  const n = getNode(canvas, event.node.id)
  if (!n) return

  // 连接预览：仅游离节点拖拽时检测（用实时拖拽位置）
  if (n.parentId === null && n.id !== ROOT_NODE_ID) {
    const center = {
      x: event.node.position.x + CONTAINER_SIZE / 2,
      y: event.node.position.y + CONTAINER_SIZE / 2
    }
    let best: { containerId: string; slot: ContainerSlot; dist: number } | null = null
    for (const other of canvas.nodes) {
      if (!canHaveChildren(other)) continue
      if (other.id === n.id) continue
      for (const slot of containerSlots(canvas, other.id)) {
        if (slot.childId !== null) continue
        const { a, b } = slotSegment(other, slot)
        const d = distToSegment(center, a, b)
        if (d < SNAP_RADIUS && (!best || d < best.dist)) {
          best = { containerId: other.id, slot, dist: d }
        }
      }
    }
    previewSlot.value = best ? { containerId: best.containerId, slot: best.slot } : null
  } else {
    previewSlot.value = null
  }

  // 记录拖拽起点（第一次事件），并缓存结构内所有节点的原始位置
  if (!dragStartPos) {
    dragStartPos = { x: event.node.position.x, y: event.node.position.y }
    dragNodeId.value = event.node.id
    pushHistory()
    dragOrig.clear()
    for (const nd of canvas.nodes) {
      if (connectedSet(n).has(nd.id)) {
        dragOrig.set(nd.id, { x: nd.position.x, y: nd.position.y })
      }
    }
    return
  }

  // 总位移 = 当前被拖节点位置 - 起始位置
  const dx = event.node.position.x - dragStartPos.x
  const dy = event.node.position.y - dragStartPos.y
  if (dx === 0 && dy === 0) return

  // 整个结构（含被拖节点自己）统一平移到 原始位置 + 总位移
  for (const [id, orig] of dragOrig) {
    const other = getNode(canvas, id)
    if (!other) continue
    if (id === event.node.id) {
      // 被拖节点：vue-flow 已在移动，写回 canvas 保证 flowNodes 同步
      other.position = { x: event.node.position.x, y: event.node.position.y }
    } else {
      other.position = { x: orig.x + dx, y: orig.y + dy }
    }
  }
}

function onDragStop(e: { node: FlowNode }): void {
  dragStartPos = null
  previewSlot.value = null
  dragNodeId.value = null
  dragOrig.clear()
  if (!project.project) return
  const canvas = project.project.schemaCanvas
  const node = getNode(canvas, e.node.id)
  if (!node) return
  node.position = { x: e.node.position.x, y: e.node.position.y }

  // 若拖的是游离节点且落到某容器空闲虚线 → 拼接
  if (!node.parentId && node.id !== ROOT_NODE_ID) {
    const center = nodeCenter(node)
    let target: SchemaNode | null = null
    let bestDist = Infinity
    for (const other of canvas.nodes) {
      if (other.id === node.id) continue
      if (!canHaveChildren(other)) continue
      for (const slot of containerSlots(canvas, other.id)) {
        if (slot.childId !== null) continue
        const { a, b } = slotSegment(other, slot)
        const d = distToSegment(center, a, b)
        if (d < SNAP_RADIUS && d < bestDist) {
          bestDist = d
          target = other
        }
      }
    }
    if (target) {
      pushHistory()
      attachTo(target, node)
      return
    }
  }
}

// ---------- 成员右键菜单操作 ----------

function memberAction(action: 'copy' | 'remove' | 'detach'): void {
  console.log(
    '[memberAction]',
    action,
    'target=',
    memberMenuTarget.value,
    'menuVisible=',
    menu.value.visible
  )
  if (!memberMenuTarget.value) return
  const id = memberMenuTarget.value
  pushHistory()
  try {
    if (action === 'copy') copyNode(id)
    else if (action === 'remove') removeNode(id)
    else if (action === 'detach') detachNode(id)
  } catch (err) {
    console.error('[memberAction] 执行失败', action, err)
    project.statusMessage = `操作失败: ${(err as Error).message}`
  }
  closeMenu()
}

/** 解绑：仅把自己从父容器向上解绑为游离节点（若自身是容器，不解绑自己的成员），并整树重排 */
function detachNode(id: string): void {
  if (!project.project) return
  const canvas = project.project.schemaCanvas
  const node = getNode(canvas, id)
  if (!node) return
  const oldParent = node.parentId
  node.parentId = null
  if (oldParent) relayoutTree(canvas)
}

/** 修改成员类型（若从容器改成普通类型，子成员解绑；若改成容器则保留） */
function changeType(type: Exclude<SchemaNode['type'], 'root'>): void {
  if (!project.project || !memberMenuTarget.value) return
  pushHistory()
  const node = getNode(project.project.schemaCanvas, memberMenuTarget.value)
  if (!node) return
  const wasContainer = isContainer(node)
  node.type = type
  if (wasContainer && !isContainer(node)) {
    // 容器 → 普通：子成员解绑为游离，并整树重排
    for (const c of project.project.schemaCanvas.nodes.filter((n) => n.parentId === node.id)) {
      c.parentId = null
    }
    relayoutTree(project.project.schemaCanvas)
  }
  closeMenu()
}

// ---------- 字段操作 ----------

function renameNode(id: string, name: string): void {
  const n = getNode(project.project?.schemaCanvas ?? { nodes: [] }, id)
  if (n) n.name = name
}

function removeNode(id: string): void {
  if (!project.project) return
  const canvas = project.project.schemaCanvas
  const node = getNode(canvas, id)
  const oldParent = node?.parentId
  // 删除整个子树（含全部子孙）
  const toRemove = new Set(collectSubtree(canvas, id))
  canvas.nodes = canvas.nodes.filter((n) => !toRemove.has(n.id))
  if (selectedId.value === id) selectedId.value = null
  if (oldParent) relayoutTree(canvas)
}

const clipboard = ref<SchemaNode[] | null>(null)

/** 深拷贝：Pinia 状态是 Vue 响应式 Proxy，structuredClone 无法克隆 Proxy，统一用 JSON 往返 */
function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T
}

/** 复制整个子树（含自身 + 全部子孙），重生成新 id，保留内部父子关系 */
function copyNode(id: string): void {
  console.log('[copy] 开始复制节点 id=', id)
  if (!project.project) {
    console.log('[copy] 无 project，中止')
    return
  }
  try {
    const canvas = project.project.schemaCanvas
    const subtreeIds = collectSubtree(canvas, id)
    console.log('[copy] 子树节点数=', subtreeIds.length, 'ids=', subtreeIds)
    const oldToNew = new Map<string, string>()
    const copies: SchemaNode[] = []
    for (const sid of subtreeIds) {
      const src = getNode(canvas, sid)
      if (!src) continue
      const copy: SchemaNode = deepClone(src)
      copy.id = newId('f')
      oldToNew.set(src.id, copy.id)
      copies.push(copy)
    }
    // 重连内部父子关系
    for (const copy of copies) {
      if (copy.parentId && oldToNew.has(copy.parentId)) {
        copy.parentId = oldToNew.get(copy.parentId)!
      } else {
        copy.parentId = null // 根复制：粘贴为游离
      }
    }
    clipboard.value = copies
    console.log(
      '[copy] 完成，clipboard 节点数=',
      copies.length,
      copies.map((c) => ({ id: c.id, name: c.name, p: c.parentId }))
    )
    project.statusMessage = `已复制「${getNode(canvas, id)?.name ?? ''}」（含 ${copies.length} 个节点）`
    project.showToast(`已复制 ${copies.length} 个节点`, 'ok')
  } catch (err) {
    console.error('[copy] 复制失败', err)
    project.statusMessage = `复制失败: ${(err as Error).message}`
    project.showToast(`复制失败: ${(err as Error).message}`, 'err')
  }
}

/** 粘贴整个子树到鼠标位置（作为游离结构） */
function pasteNode(): void {
  console.log(
    '[paste] 开始粘贴，clipboard=',
    clipboard.value?.length ?? 0,
    'menuFlowPoint=',
    menuFlowPoint.value
  )
  if (!project.project || !clipboard.value) {
    console.log('[paste] 无 project 或 clipboard 为空，中止')
    closeMenu()
    return
  }
  try {
    pushHistory()
    const canvas = project.project.schemaCanvas
    const clip = clipboard.value
    const rootCopy = clip.find((c) => !c.parentId || !clip.some((o) => o.id === c.parentId))
    const anchor = rootCopy ?? clip[0]
    if (!anchor) {
      console.log('[paste] 找不到锚点节点，中止')
      closeMenu()
      return
    }
    const dx = (menuFlowPoint.value.x || lastMouseFlow.value.x) - anchor.position.x
    const dy = (menuFlowPoint.value.y || lastMouseFlow.value.y) - anchor.position.y
    for (const copy of clip) {
      copy.position.x += dx
      copy.position.y += dy
    }
    canvas.nodes.push(...clipboard.value)
    selectedId.value = anchor.id
    clipboard.value = null
    console.log('[paste] 完成，新增节点数=', clip.length)
    project.showToast(`已粘贴 ${clip.length} 个节点`, 'ok')
  } catch (err) {
    console.error('[paste] 粘贴失败', err)
    project.statusMessage = `粘贴失败: ${(err as Error).message}`
    project.showToast(`粘贴失败: ${(err as Error).message}`, 'err')
  }
  closeMenu()
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedId.value) {
    copyNode(selectedId.value)
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    pasteNode()
  } else if (e.key === 'Delete' && selectedId.value) {
    pushHistory()
    removeNode(selectedId.value)
  }
}

/** 最近一次鼠标在画布上的流坐标（供 Ctrl+V 粘贴定位） */
const lastMouseFlow = ref<{ x: number; y: number }>({ x: 200, y: 200 })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// ---------- LLM 结果应用 ----------

function onLlmResult(content: string): void {
  if (!project.project) return
  const idx = content.indexOf('z.object')
  if (idx < 0) return
  let depth = 0
  let inString: string | null = null
  for (let i = idx; i < content.length; i++) {
    const c = content[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === inString) inString = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') inString = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        try {
          pushHistory()
          project.project.schemaCanvas = zodToCanvas(content.slice(idx, i + 1))
        } catch {
          // 忽略解析失败
        }
        return
      }
    }
  }
}

// 给 inspector 的当前画布
const canvas = computed(() => project.project?.schemaCanvas ?? { nodes: [] })

// ---------- 生成代码预览（点击刷新后更新） ----------
const generatedCode = ref('')
const codeExpanded = ref(true)

function refreshGeneratedCode(): void {
  if (!project.project) {
    generatedCode.value = ''
    return
  }
  const code = canvasToZodCode(project.project.schemaCanvas)
  generatedCode.value = `export const Schema = ${code}\n`
  project.showToast('已刷新 Schema 代码', 'ok')
}

async function copyGeneratedCode(): Promise<void> {
  if (!generatedCode.value) return
  try {
    await navigator.clipboard.writeText(generatedCode.value)
    project.showToast('已复制 Schema 代码', 'ok')
  } catch (err) {
    project.showToast(`复制失败: ${(err as Error).message}`, 'err')
  }
}
</script>

<template>
  <div class="page schema-page">
    <div class="schema-toolbar">
      <select v-model="scriptPick" class="text-input script-pick" @change="loadFromScript">
        <option value="">— 从酒馆助手 Zod 脚本加载 —</option>
        <option v-for="[key, s] in zodScripts" :key="key" :value="key">
          {{ scriptDisplayName(key, s.content) }}
        </option>
      </select>
      <button class="btn btn-primary import-btn" @click="importToScript">
        ⬇ 一键导入为 Zod 脚本
      </button>
      <button class="btn btn-ghost" @click="locateRoot">◎ 定位主 Schema</button>
      <button class="btn btn-ghost" @click="fitView({ padding: 0.2 })">⛶ 适配</button>
      <button class="btn btn-ghost" @click="pasteNode">📋 粘贴</button>
      <span class="hint"
        >右键：空白=环形新建游离字段 · 选中成员=成员菜单 · Shift+右键=全局菜单 · Ctrl+Z/Y
        撤销/重做</span
      >
    </div>

    <div class="schema-body">
      <div
        class="canvas-wrap"
        @mousedown="canvasMousedown"
        @contextmenu="canvasContextmenu"
        @mousemove="onMenuMove"
        @mouseup="onMenuUp"
      >
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :edge-types="edgeTypes"
          :min-zoom="0.2"
          :max-zoom="2.5"
          @node-drag="onNodeDrag"
          @node-drag-start="closeMenu"
          @node-drag-stop="onDragStop"
          @node-click="
            (e: { node: FlowNode }) => {
              selectedId = e.node.id
              closeMenu()
            }
          "
          @pane-click="
            () => {
              selectedId = null
              closeMenu()
            }
          "
        >
          <template #node-schemaNode="nodeProps">
            <SchemaCircle
              :node="nodeProps.data.node"
              :canvas="project.project!.schemaCanvas"
              :selected="selectedId === nodeProps.id"
              :highlighted="selectedId !== null && isInSubtree(nodeProps.id, selectedId)"
              :dragging="dragNodeId === nodeProps.id"
              :preview-target="previewSlot?.containerId === nodeProps.id"
              :virtual="Boolean(nodeProps.data.virtual)"
              :data-node-id="nodeProps.id"
              @select="selectedId = nodeProps.id"
              @rename="(n: string) => renameNode(nodeProps.id, n)"
              @remove="removeNode(nodeProps.id)"
              @copy="copyNode(nodeProps.id)"
            />
          </template>
          <Background :gap="16" />
          <Controls />
          <MiniMap position="bottom-right" />
        </VueFlow>

        <!-- 环形菜单（空白右键新建游离字段） -->
        <div
          v-if="menu.visible && menu.kind === 'radial'"
          class="radial-menu"
          data-menu
          :style="{ left: menu.px + 'px', top: menu.py + 'px' }"
          @contextmenu.prevent
        >
          <div class="radial-center">＋</div>
          <button
            v-for="(t, i) in TYPE_LIST"
            :key="t.type"
            class="radial-item"
            :class="{ hover: hoverType === t.type }"
            :style="{ '--i': i, '--item-color': t.color }"
            @mousedown.stop.prevent="createNodeAt(t.type)"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- 成员菜单（选中成员后右键） -->
        <div
          v-if="menu.visible && menu.kind === 'member'"
          class="ctx-menu"
          data-menu
          :style="{ left: menu.px + 'px', top: menu.py + 'px' }"
          @contextmenu.prevent
        >
          <div class="ctx-title">成员操作</div>
          <button class="ctx-item" @mousedown.stop.prevent="memberAction('copy')">⧉ 复制</button>
          <button class="ctx-item" @mousedown.stop.prevent="memberAction('detach')">
            ⇱ 解绑（仅向上）
          </button>
          <button class="ctx-item danger" @mousedown.stop.prevent="memberAction('remove')">
            🗑 删除
          </button>
          <div class="ctx-title">修改类型</div>
          <div class="ctx-types">
            <button
              v-for="t in TYPE_LIST"
              :key="t.type"
              class="ctx-item type"
              :class="{ active: getNode(canvas, memberMenuTarget ?? '')?.type === t.type }"
              @mousedown.stop.prevent="changeType(t.type)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- 全局菜单（Shift+右键） -->
        <div
          v-if="menu.visible && menu.kind === 'global'"
          class="ctx-menu"
          data-menu
          :style="{ left: menu.px + 'px', top: menu.py + 'px' }"
          @contextmenu.prevent
        >
          <div class="ctx-title">全局操作</div>
          <button class="ctx-item" @mousedown.stop.prevent="pasteNode">📋 粘贴</button>
          <button class="ctx-item" @mousedown.stop.prevent="locateAndClose">◎ 定位主 Schema</button>
          <button class="ctx-item" @mousedown.stop.prevent="undoThenClose">↩ 撤销 (Ctrl+Z)</button>
          <button class="ctx-item" @mousedown.stop.prevent="redoThenClose">↪ 重做 (Ctrl+Y)</button>
        </div>
      </div>

      <aside class="inspector">
        <!-- 生成代码预览 -->
        <div class="code-preview">
          <div class="code-preview-head">
            <button class="code-toggle" @click="codeExpanded = !codeExpanded">
              {{ codeExpanded ? '▾' : '▸' }} 生成 Schema 代码
            </button>
            <div class="code-preview-actions">
              <button class="btn btn-ghost btn-sm" @click="refreshGeneratedCode">🔄 刷新</button>
              <button
                class="btn btn-ghost btn-sm"
                :disabled="!generatedCode"
                @click="copyGeneratedCode"
              >
                ⧉ 复制
              </button>
            </div>
          </div>
          <div v-if="codeExpanded" class="code-preview-body">
            <textarea
              v-model="generatedCode"
              class="code-preview-area mono"
              rows="12"
              readonly
              spellcheck="false"
              placeholder="点击「刷新」查看当前 Schema 生成的 zod 代码"
            ></textarea>
            <p class="code-preview-tip">点击刷新按钮更新代码（非实时）。</p>
          </div>
        </div>

        <FieldInspector
          v-if="selectedId"
          :node="getNode(canvas, selectedId) ?? null"
          :canvas="canvas"
          @close="selectedId = null"
        />
        <div v-else class="inspector-empty">点击画布上的字段节点，编辑类型细节、默认值与描述</div>
        <LlmChatPanel feature-id="schema" show-worldbook-select @result="onLlmResult" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.schema-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}
.schema-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(19, 25, 38, 0.9);
  border-bottom: 1px solid var(--border);
}
.script-pick {
  width: 220px;
  height: 30px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  color: var(--text-main);
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
}
.schema-toolbar .hint {
  color: var(--text-muted);
  font-size: 12px;
  margin-left: auto;
}
.schema-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.canvas-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.inspector {
  width: 300px;
  min-width: 300px;
  background: rgba(19, 25, 38, 0.92);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding: 12px;
}
.inspector-empty {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 40px 0;
}

/* ---------- 生成代码预览 ---------- */
.code-preview {
  background: #0f1420;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}
.code-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: #161d2b;
  border-bottom: 1px solid var(--border);
  gap: 6px;
}
.code-toggle {
  background: transparent;
  border: none;
  color: var(--accent-bright);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
}
.code-preview-actions {
  display: flex;
  gap: 4px;
}
.code-preview-body {
  padding: 6px;
}
.code-preview-area {
  width: 100%;
  box-sizing: border-box;
  background: #0b1019;
  border: 1px solid var(--border-strong);
  color: #7be0a3;
  border-radius: 6px;
  padding: 8px;
  font-family: var(--mono);
  font-size: 11px;
  resize: vertical;
  line-height: 1.5;
}
.code-preview-tip {
  color: var(--text-muted);
  font-size: 10px;
  margin: 4px 0 0;
}
.btn-sm {
  padding: 2px 8px;
  font-size: 11px;
}

/* ---------- 环形菜单 ---------- */
.radial-menu {
  position: absolute;
  z-index: 30;
  width: 0;
  height: 0;
}
.radial-center {
  position: absolute;
  left: -22px;
  top: -22px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #000;
  border: 1px solid var(--accent);
  color: var(--accent-bright);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 16px;
}
.radial-item {
  position: absolute;
  left: -30px;
  top: -14px;
  width: 60px;
  height: 28px;
  border-radius: 14px;
  background: #1a2233;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  transform: rotate(calc(var(--i) * 51.43deg)) translateY(-96px) rotate(calc(var(--i) * -51.43deg));
  transition:
    border-color 0.1s,
    color 0.1s,
    background 0.1s;
}
.radial-item.hover {
  border-color: var(--item-color);
  color: #fff;
  background: var(--item-color);
}

/* ---------- 上下文菜单（成员/全局） ---------- */
.ctx-menu {
  position: absolute;
  z-index: 40;
  min-width: 150px;
  background: #171e2c;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  user-select: none;
}
.ctx-title {
  color: var(--text-muted);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 4px 8px 2px;
}
.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
}
.ctx-item:hover {
  background: #1c2434;
  color: #fff;
}
.ctx-item.danger:hover {
  background: rgba(255, 93, 93, 0.15);
  color: var(--danger);
}
.ctx-item.type {
  display: inline-block;
  width: auto;
  margin: 2px;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-size: 11px;
}
.ctx-item.type.active {
  border-color: var(--accent);
  color: var(--accent-bright);
}
.ctx-types {
  padding: 0 4px 4px;
}
.btn-ghost {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
}
.btn-ghost:hover {
  border-color: var(--accent);
  color: #fff;
}
</style>
