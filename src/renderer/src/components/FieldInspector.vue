<script setup lang="ts">
import { computed } from 'vue'
import type { SchemaCanvas, SchemaNode } from '../../../shared/types'

const props = defineProps<{
  node: SchemaNode | null
  canvas: SchemaCanvas
}>()
const emit = defineEmits<{
  close: []
}>()

const n = computed(() => props.node)

function setClamp(min: string, max: string): void {
  if (!n.value) return
  if (!n.value.numberConfig) n.value.numberConfig = {}
  n.value.numberConfig.clampMin = min.trim() === '' ? null : Number(min)
  n.value.numberConfig.clampMax = max.trim() === '' ? null : Number(max)
}

function ensureNumberConfig(): NonNullable<SchemaNode['numberConfig']> {
  if (!n.value) return {}
  if (!n.value.numberConfig) n.value.numberConfig = {}
  return n.value.numberConfig
}
const nc = computed(() => ensureNumberConfig() as NonNullable<SchemaNode['numberConfig']>)
</script>

<template>
  <div v-if="n" class="inspector-panel">
    <div class="inspector-head">
      <span>字段详情</span>
      <button class="btn-close" @click="emit('close')">✕</button>
    </div>

    <div class="insp-field">
      <label>名称</label>
      <input v-model="n.name" placeholder="字段名" />
      <p class="tip">前缀 _ 只读(AI可见不可改)；前缀 $ 隐藏(AI不可见)</p>
    </div>

    <div class="insp-field">
      <label>类型</label>
      <span class="type-badge">{{ n.type }}</span>
    </div>

    <template v-if="n.type === 'string'">
      <div class="insp-field">
        <label>默认值 (prefault)</label>
        <input v-model="n.stringPrefault" placeholder="留空则不设默认" />
      </div>
    </template>

    <template v-if="n.type === 'number'">
      <div class="insp-field">
        <label>整数</label>
        <input v-model="nc.int" type="checkbox" />
      </div>
      <div class="insp-field">
        <label>范围下限 (clamp)</label>
        <input
          :value="nc.clampMin ?? ''"
          type="number"
          placeholder="不限"
          @change="setClamp(($event.target as HTMLInputElement).value, String(nc.clampMax ?? ''))"
        />
      </div>
      <div class="insp-field">
        <label>范围上限 (clamp)</label>
        <input
          :value="nc.clampMax ?? ''"
          type="number"
          placeholder="不限"
          @change="setClamp(String(nc.clampMin ?? ''), ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="insp-field">
        <label>默认值</label>
        <input v-model="nc.prefault" type="number" placeholder="0" />
      </div>
    </template>

    <template v-if="n.type === 'boolean'">
      <div class="insp-field">
        <label>默认值</label>
        <input v-model="n.booleanPrefault" type="checkbox" />
      </div>
    </template>

    <template v-if="n.type === 'enum'">
      <div class="insp-field">
        <label>枚举值（换行分隔）</label>
        <textarea
          :value="(n.enumValues ?? []).join('\n')"
          rows="4"
          @input="
            n.enumValues = ($event.target as HTMLTextAreaElement).value
              .split('\n')
              .filter((s) => s.trim() !== '')
          "
        ></textarea>
        <p class="tip">z.enum 会限制 AI 自然表达，仅 EJS 精确匹配时使用</p>
      </div>
      <div class="insp-field">
        <label>默认值 (prefault)</label>
        <select v-model="n.enumPrefault">
          <option value="">（不设默认）</option>
          <option v-for="v in n.enumValues ?? []" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>
    </template>

    <template v-if="n.type === 'record'">
      <p class="tip">record 键固定为 string；拖拽字段到本节点右侧连接线即成为 value 结构成员。</p>
    </template>

    <template v-if="n.type === 'object'">
      <p class="tip">拖拽字段到本节点右侧连接线，即可成为该对象的子字段（可无限嵌套）。</p>
    </template>

    <template v-if="n.type === 'union'">
      <p class="tip">
        union =
        该字段的值可以是多种类型中的一种。拖拽字段到本节点右侧连接线，每个子节点即一种可选类型（如
        z.union([z.string(), z.number()])）。AI 输出时选其中一种。
      </p>
    </template>

    <div class="insp-field">
      <label>描述 (describe)</label>
      <textarea
        v-model="n.describe"
        rows="2"
        placeholder="字段语义说明，会注入 .describe()"
      ></textarea>
    </div>
  </div>
</template>

<style scoped>
.inspector-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--accent-bright);
  font-weight: 700;
  margin-bottom: 12px;
}
.btn-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}
.insp-field {
  margin-bottom: 12px;
}
.insp-field label {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 4px;
}
.insp-field input:not([type='checkbox']),
.insp-field select,
.insp-field textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  color: var(--text-main);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}
.insp-field textarea {
  resize: vertical;
}
.type-badge {
  background: var(--accent-dim);
  color: var(--accent-bright);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
}
.tip {
  color: var(--text-muted);
  font-size: 11px;
  margin: 4px 0 0;
}
</style>
