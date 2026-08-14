// 槽位布局验证：
// 1) containerSlots 从成员当前位置反推 yOffset（拼接后保持不动），空闲虚线在最下方
// 2) layoutCanvas 读取后按水平树状均匀展开
import {
  createEmptyCanvas,
  containerSlots,
  memberPosition,
  slotEndPos,
  layoutCanvas,
  childrenOf,
  ROOT_NODE_ID
} from '../src/shared/schema'

let ok = true
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${msg}`)
  if (!cond) ok = false
}

const canvas = createEmptyCanvas()
const root = canvas.nodes[0]

// 0 成员：只有一条空闲虚线 → yOffset 0
let slots = containerSlots(canvas, ROOT_NODE_ID)
check(
  slots.length === 1 && slots[0].childId === null && slots[0].yOffset === 0,
  '0成员：1条空闲虚线 yOffset=0'
)

// 加 3 个成员（模拟拼接后的位置：m1 y=10, m2 y=86, m3 y=162，间隔 76）
const m1 = {
  id: 'm1',
  name: 'a',
  type: 'string',
  parentId: ROOT_NODE_ID,
  position: { x: 200, y: 10 }
}
const m2 = {
  id: 'm2',
  name: 'b',
  type: 'number',
  parentId: ROOT_NODE_ID,
  position: { x: 200, y: 86 }
}
const m3 = {
  id: 'm3',
  name: 'c',
  type: 'boolean',
  parentId: ROOT_NODE_ID,
  position: { x: 200, y: 162 }
}
canvas.nodes.push(m1, m2, m3)

slots = containerSlots(canvas, ROOT_NODE_ID)
console.log('[3成员]', slots.map((s) => `${s.childId ?? 'free'}:y=${s.yOffset}`).join('  '))

// containerSlots：成员线末端相对主干中心的偏移（root.y=40, root 中心=40+54=94）
const m1s = slots.find((s) => s.childId === 'm1')!
const m2s = slots.find((s) => s.childId === 'm2')!
const m3s = slots.find((s) => s.childId === 'm3')!
const free = slots.find((s) => s.childId === null)!
// m1: 10+22-94=-62, m2: 86+22-94=14, m3: 162+22-94=90
check(
  m1s.yOffset === -62 && m2s.yOffset === 14 && m3s.yOffset === 90,
  'containerSlots 线末端偏移正确'
)
// 空闲虚线：最后成员(rect)完整区域之下 = m3偏移90 + MEMBER_GAP(76) + RECT_HEIGHT(44) = 210
check(free.yOffset === 210, `空闲虚线在最下方成员完整区域之下 (${free.yOffset})`)

// memberPosition：成员左缘落在线末端（end.x），竖直中心落在线末端（end.y）
const p3 = memberPosition(canvas, root, m3s)
const e3 = slotEndPos(root, m3s)
check(
  Math.round(p3.y + 22) === Math.round(e3.y),
  `成员竖直中心落在线末端 (${Math.round(p3.y + 22)}==${Math.round(e3.y)})`
)
check(
  Math.round(p3.x) === Math.round(e3.x),
  `成员左缘落在线末端 (${Math.round(p3.x)}==${Math.round(e3.x)})`
)

// layoutCanvas：读取后均匀展开
const canvas2 = createEmptyCanvas()
const r2 = canvas2.nodes[0]
const c1 = {
  id: 'c1',
  name: '甲',
  type: 'object',
  parentId: ROOT_NODE_ID,
  position: { x: 0, y: 0 }
}
const c2 = {
  id: 'c2',
  name: '乙',
  type: 'record',
  parentId: ROOT_NODE_ID,
  position: { x: 0, y: 0 }
}
canvas2.nodes.push(c1, c2)
const k1 = { id: 'k1', name: '修为', type: 'number', parentId: 'c1', position: { x: 0, y: 0 } }
const k2 = { id: 'k2', name: '宗门', type: 'object', parentId: 'c1', position: { x: 0, y: 0 } }
canvas2.nodes.push(k1, k2)
layoutCanvas(canvas2)

const top2 = childrenOf(canvas2, ROOT_NODE_ID)
check(top2[0].position.y !== top2[1].position.y, 'layoutCanvas 顶层成员展开')
const c1kids = childrenOf(canvas2, 'c1')
check(c1kids[0].position.y !== c1kids[1].position.y, 'layoutCanvas 嵌套成员展开')
void r2

console.log(ok ? '\nALL PASSED' : '\nFAILED')
process.exit(ok ? 0 : 1)
