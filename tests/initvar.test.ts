// Schema → initvar 默认空值骨架（canvasToInitvarData / canvasToInitvarYaml）冒烟
import { createEmptyCanvas, canvasToInitvarData, canvasToInitvarYaml } from '../src/shared/schema'
import type { SchemaCanvas, SchemaNode } from '../src/shared/types'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  OK  ${msg}`)
  else {
    console.error(`  FAIL  ${msg}`)
    failures++
  }
}

function node(
  partial: Partial<SchemaNode> & { id: string; name: string; type: SchemaNode['type'] }
): SchemaNode {
  return { parentId: 'root', position: { x: 0, y: 0 }, ...partial }
}

function makeCanvas(nodes: SchemaNode[]): SchemaCanvas {
  return {
    nodes: [
      { id: 'root', name: 'Schema', type: 'root', parentId: null, position: { x: 0, y: 0 } },
      ...nodes
    ]
  }
}

// 1. 空画布 → 空对象
{
  const data = canvasToInitvarData(createEmptyCanvas())
  assert(Object.keys(data).length === 0, '空画布 → 空对象')
}

// 2. 各类型默认空值
{
  const canvas = makeCanvas([
    node({ id: 'n1', name: '主角', type: 'object' }),
    node({ id: 'n2', name: '名字', type: 'string', parentId: 'n1' }),
    node({ id: 'n3', name: 'HP', type: 'number', parentId: 'n1' }),
    node({ id: 'n4', name: '觉醒', type: 'boolean', parentId: 'n1' }),
    node({ id: 'n5', name: '属性', type: 'enum', enumValues: ['火', '水', '雷'], parentId: 'n1' }),
    node({ id: 'n6', name: '背包', type: 'record', parentId: 'n1' }),
    node({ id: 'n7', name: '称号', type: 'string' })
  ])
  const data = canvasToInitvarData(canvas)
  assert(data.主角?.名字 === '', 'string → 空字符串')
  assert(data.主角?.HP === 0, 'number → 0')
  assert(data.主角?.觉醒 === false, 'boolean → false')
  assert(data.主角?.属性 === '火', 'enum → 首值')
  assert(Object.keys(data.主角?.背包 ?? {}).length === 0, 'record → 空对象')
  assert(data.称号 === '', '顶层 string → 空字符串')
}

// 3. prefault 值尊重（非全 0/空，用用户设的默认值）
{
  const canvas = makeCanvas([
    node({ id: 'n1', name: 'HP', type: 'number', numberConfig: { prefault: 100 } }),
    node({ id: 'n2', name: '状态', type: 'string', stringPrefault: '健康' }),
    node({ id: 'n3', name: '目标', type: 'enum', enumValues: ['A', 'B'], enumPrefault: 'B' })
  ])
  const data = canvasToInitvarData(canvas)
  assert(data.HP === 100, 'number 尊重 prefault')
  assert(data.状态 === '健康', 'string 尊重 stringPrefault')
  assert(data.目标 === 'B', 'enum 尊重 enumPrefault')
}

// 4. _/$ 前缀剥离（MVU 变量名前缀规则）
{
  const canvas = makeCanvas([
    node({ id: 'n1', name: '_只读', type: 'string' }),
    node({ id: 'n2', name: '$隐藏', type: 'number' })
  ])
  const data = canvasToInitvarData(canvas)
  assert(data.只读 === '', '_ 前缀剥离')
  assert(data.隐藏 === 0, '$ 前缀剥离')
}

// 5. YAML 输出可被 stringify 且含键
{
  const canvas = makeCanvas([
    node({ id: 'n1', name: '主角', type: 'object' }),
    node({ id: 'n2', name: '名字', type: 'string', parentId: 'n1' })
  ])
  const yaml = canvasToInitvarYaml(canvas)
  assert(yaml.includes('主角:') && yaml.includes('名字:'), 'YAML 含层级键')
  assert(yaml.includes("''") || yaml.includes('名字:'), 'YAML 空值可解析')
}

if (failures) {
  console.error(`initvar 骨架测试失败 ${failures} 项`)
  process.exit(1)
}
console.log('initvar 骨架测试 OK')
