<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import { TRUNK_LEN, LINK_LEN } from '../../../shared/schema'

const props = defineProps<EdgeProps>()

// 手动构造水平树状正交路径：
// 起点(容器右缘中心) → 水平向右 TRUNK_LEN（主干）→ 竖直分野到成员高度 → 水平向右 LINK_LEN 接到成员左缘
// 实线与虚线（第 N+1 个虚拟成员）走完全相同的路径，几何必然一致
const path = computed(() => {
  const { sourceX, sourceY, targetX, targetY } = props
  const midX = sourceX + TRUNK_LEN
  const endX = midX + LINK_LEN
  return `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${endX} ${targetY} L ${targetX} ${targetY}`
})

const color = computed(() => (props.data as { color?: string } | undefined)?.color ?? '#f5a623')
const dashed = computed(() => Boolean((props.data as { dashed?: boolean } | undefined)?.dashed))
const highlight = computed(() =>
  Boolean((props.data as { highlight?: boolean } | undefined)?.highlight)
)
</script>

<template>
  <BaseEdge
    :id="props.id"
    :path="path"
    :marker-end="props.markerEnd"
    :style="{
      stroke: color,
      strokeWidth: highlight ? 3 : 2,
      strokeDasharray: dashed ? '6 4' : 'none',
      opacity: dashed ? (highlight ? 1 : 0.7) : 1,
      filter: highlight ? 'drop-shadow(0 0 3px rgba(245,166,35,.8))' : 'none'
    }"
  />
</template>
