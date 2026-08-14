<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { SchemaCanvas, SchemaNode } from '../../../shared/types'
import { containerSlots, canHaveChildren, TRUNK_LEN } from '../../../shared/schema'

const props = defineProps<{
  node: SchemaNode | null
  selected: boolean
  highlighted: boolean
  dragging: boolean
  previewTarget: boolean
  virtual: boolean
  canvas: SchemaCanvas
}>()
const emit = defineEmits<{
  (e: 'select'): void
  (e: 'rename', name: string): void
  (e: 'remove'): void
  (e: 'copy'): void
}>()

const TYPE_STYLES: Record<string, { color: string; label: string }> = {
  string: { color: '#58a6ff', label: '文本' },
  number: { color: '#3ddc84', label: '数值' },
  boolean: { color: '#ffb020', label: '布尔' },
  enum: { color: '#c678dd', label: '枚举' },
  record: { color: '#f5a623', label: '记录' },
  object: { color: '#f5a623', label: '对象' },
  union: { color: '#56d4dd', label: '联合' },
  root: { color: '#ffffff', label: '主' }
}

const node = computed(() => props.node)
const style = (): { color: string; label: string } =>
  TYPE_STYLES[node.value?.type ?? 'string'] ?? TYPE_STYLES.string
// 容器 = 圆形（root/object/record）；其余字段 = 矩形
const isContainer = (): boolean =>
  node.value?.type === 'object' || node.value?.type === 'record' || node.value?.type === 'root'

// 可收子节点（含 union）：有 source handle 收可选类型/成员
const hasChildren = (): boolean => (node.value ? canHaveChildren(node.value) : false)

// 容器的连接槽位（已连接 = 实线起点，空闲 = 虚线起点）
const slots = computed(() =>
  hasChildren() && node.value ? containerSlots(props.canvas, node.value.id) : []
)

void TRUNK_LEN
</script>

<template>
  <!-- 虚拟节点（第 N+1 个成员的虚线目标）：渲染为不可见锚点 -->
  <div v-if="virtual" class="virtual-anchor"></div>

  <!-- 普通节点 -->
  <div
    v-else-if="node"
    class="schema-node"
    :data-node-id="node.id"
    :class="[
      `t-${node.type}`,
      {
        circle: isContainer(),
        rect: !isContainer(),
        selected,
        highlighted: highlighted && !selected,
        dragging,
        'preview-target': previewTarget && !selected,
        root: node.type === 'root',
        free: !node.parentId && node.type !== 'root'
      }
    ]"
    :style="{ '--node-color': style().color }"
    @click="emit('select')"
  >
    <!-- 左连接点：接收父节点（对象/记录/根/union 均可作为成员被连接） -->
    <Handle v-if="hasChildren()" type="target" :position="Position.Left" class="dot-handle" />
    <!-- 普通字段：左侧中心接收父节点的连接线 -->
    <Handle v-else type="target" :position="Position.Left" class="dot-handle" />

    <div class="node-body">
      <input
        v-if="node.type !== 'root'"
        class="node-name"
        :value="node.name"
        placeholder="字段名"
        spellcheck="false"
        @click.stop
        @input="emit('rename', ($event.target as HTMLInputElement).value)"
      />
      <div v-else class="node-name root-name">Schema</div>
      <span class="node-type">{{ style().label }}</span>
    </div>

    <div v-if="selected" class="node-actions">
      <button class="node-btn" title="复制" @click.stop="emit('copy')">⧉</button>
      <button class="node-btn danger" title="删除" @click.stop="emit('remove')">✕</button>
    </div>

    <!-- 可收子节点的节点：右侧伸出连接线（成员实线 + 空闲虚线均由 TreeEdge 绘制） -->
    <template v-if="hasChildren()">
      <!-- 成员 source handle：全部在节点右缘中心（单一出发点） -->
      <Handle
        v-for="slot in slots.filter((s) => s.childId !== null)"
        :id="`slot-${slot.childId}`"
        :key="slot.childId!"
        type="source"
        :position="Position.Right"
        class="dot-handle"
      />
      <!-- 空闲虚线 source handle（第 N+1 个虚拟成员） -->
      <Handle id="slot-free" type="source" :position="Position.Right" class="dot-handle" />
    </template>
  </div>
</template>

<style scoped>
.schema-node {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 25%, #1d2636, #0e1420);
  border: 2px solid var(--node-color, #58a6ff);
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  transition:
    box-shadow 0.15s,
    border-color 0.15s;
}
/* 容器：圆形 */
.schema-node.circle {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  flex-direction: column;
  gap: 2px;
}
/* 其他字段：矩形 */
.schema-node.rect {
  width: 150px;
  height: 44px;
  border-radius: 10px;
  flex-direction: row;
  padding: 0 10px;
  overflow: hidden;
}
.schema-node:hover {
  box-shadow:
    0 0 0 2px rgba(88, 166, 255, 0.25),
    0 4px 16px rgba(0, 0, 0, 0.5);
}
.schema-node.selected {
  box-shadow:
    0 0 0 2px var(--node-color),
    0 4px 18px rgba(0, 0, 0, 0.6);
}
.schema-node.highlighted {
  box-shadow:
    0 0 0 2px rgba(245, 166, 35, 0.45),
    0 4px 14px rgba(0, 0, 0, 0.5);
  border-color: var(--accent);
}
.schema-node.root {
  width: 108px;
  height: 108px;
  border-style: double;
  border-width: 4px;
}
.schema-node.free {
  border-style: dashed;
  opacity: 0.85;
}
/* 拖拽中的节点：半透明预览 */
.schema-node.dragging {
  opacity: 0.55;
}
/* 连接预览目标：容器高亮 + 虚线变亮 */
.schema-node.preview-target {
  box-shadow:
    0 0 0 2px rgba(245, 166, 35, 0.6),
    0 4px 18px rgba(0, 0, 0, 0.6);
  border-color: var(--accent);
}
/* 虚拟节点（虚线目标锚点）：不可见 */
.virtual-anchor {
  width: 0;
  height: 0;
  pointer-events: none;
}
.node-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
  height: 100%;
}
.rect .node-body {
  flex-direction: row;
  gap: 8px;
  align-items: center;
  justify-content: flex-start;
  padding: 0 4px;
}
.node-name {
  background: transparent;
  border: none;
  text-align: center;
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
  outline: none;
  width: 72px;
  min-width: 0;
}
.rect .node-name {
  flex: 1;
  width: auto;
  min-width: 0;
  text-align: left;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-name:focus {
  color: var(--accent-bright);
}
.root-name {
  color: var(--accent-bright);
  font-size: 14px;
  font-weight: 800;
}
.node-type {
  font-size: 10px;
  color: var(--node-color, #58a6ff);
  opacity: 0.9;
  white-space: nowrap;
}
.node-actions {
  position: absolute;
  top: -10px;
  right: -10px;
  display: flex;
  gap: 2px;
  background: #0e1420;
  border-radius: 8px;
  padding: 2px;
}
.node-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  padding: 0 3px;
}
.node-btn:hover {
  color: var(--accent-bright);
}
.node-btn.danger:hover {
  color: var(--danger);
}
.dot-handle {
  width: 10px !important;
  height: 10px !important;
  background: var(--node-color, #58a6ff) !important;
  border: 2px solid #0e1420 !important;
  opacity: 0.85;
  transform: translate(-50%, -50%);
}
</style>
