// 复制/粘贴子树逻辑验证：深拷贝整棵子树、重生成 id、保留父子关系
import {
  createEmptyCanvas,
  childrenOf,
  ROOT_NODE_ID,
  getNode,
  newId,
  collectSubtree
} from '../src/shared/schema'
import type { SchemaNode } from '../src/shared/types'

let ok = true
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${msg}`)
  if (!cond) ok = false
}

function deepClone<T>(o: T): T {
  if (typeof structuredClone === 'function') return structuredClone(o)
  return JSON.parse(JSON.stringify(o))
}

/** 复制子树逻辑（与组件内一致） */
function copySubtree(canvas: ReturnType<typeof createEmptyCanvas>, id: string): SchemaNode[] {
  const subtreeIds = collectSubtree(canvas, id)
  const oldToNew = new Map<string, string>()
  const copies: SchemaNode[] = []
  for (const sid of subtreeIds) {
    const src = getNode(canvas, sid)
    if (!src) continue
    const copy = deepClone(src)
    copy.id = newId('f')
    oldToNew.set(src.id, copy.id)
    copies.push(copy)
  }
  for (const copy of copies) {
    if (copy.parentId && oldToNew.has(copy.parentId)) copy.parentId = oldToNew.get(copy.parentId)!
    else copy.parentId = null
  }
  return copies
}

const canvas = createEmptyCanvas()
const hero: SchemaNode = {
  id: 'hero',
  name: '主角',
  type: 'object',
  parentId: ROOT_NODE_ID,
  position: { x: 0, y: 0 }
}
const hp: SchemaNode = {
  id: 'hp',
  name: '修为',
  type: 'number',
  parentId: 'hero',
  position: { x: 0, y: 0 }
}
const sect: SchemaNode = {
  id: 'sect',
  name: '宗门',
  type: 'object',
  parentId: 'hero',
  position: { x: 0, y: 0 }
}
const sectName: SchemaNode = {
  id: 'sectName',
  name: '名称',
  type: 'string',
  parentId: 'sect',
  position: { x: 0, y: 0 }
}
canvas.nodes.push(hero, hp, sect, sectName)

// 复制 主角 子树 → 应含 4 个节点
const copies = copySubtree(canvas, 'hero')
check(copies.length === 4, `复制主角子树 = 4 节点 (${copies.length})`)

// 根复制 parentId=null
const rootCopy = copies.find((c) => c.name === '主角')!
check(rootCopy.parentId === null, '主角复制根 parentId=null')

// 内部父子关系保留（宗门 → 名称）
const sectCopy = copies.find((c) => c.name === '宗门')!
const nameCopy = copies.find((c) => c.name === '名称')!
check(nameCopy.parentId === sectCopy.id, '宗门→名称 父子关系保留')

// 修为 → 主角
const hpCopy = copies.find((c) => c.name === '修为')!
check(hpCopy.parentId === rootCopy.id, '修为→主角 父子关系保留')

// 新 id 不与原冲突
check(!copies.some((c) => c.id === 'hero' || c.id === 'hp' || c.id === 'sect'), '新 id 不与原冲突')

// 层级数正确（树形：主角>宗门>名称 深 3）
function depth(id: string, canvas: typeof canvas, d = 1): number {
  const kids = childrenOf(canvas, id)
  if (kids.length === 0) return d
  return Math.max(...kids.map((k) => depth(k.id, canvas, d + 1)))
}
check(
  depth(rootCopy.id, { nodes: copies as unknown as SchemaNode[] } as typeof canvas) === 3,
  '复制子树层级 3'
)

// ---- 粘贴流程：把 copies 插入一个新画布，验证节点出现且结构正确 ----
const pasteCanvas = createEmptyCanvas()
const mousePos = { x: 500, y: 400 }
const rootCopy2 =
  copies.find((c) => !c.parentId || !copies.some((o) => o.id === c.parentId)) ?? copies[0]
const dx = mousePos.x - rootCopy2.position.x
const dy = mousePos.y - rootCopy2.position.y
for (const c of copies) {
  c.position.x += dx
  c.position.y += dy
}
pasteCanvas.nodes.push(...copies)
check(pasteCanvas.nodes.length === 5, `粘贴后画布 = 5 节点 (${pasteCanvas.nodes.length})`) // root + 4
const pastedRoot = pasteCanvas.nodes.find((n) => n.name === '主角')!
check(
  Math.round(pastedRoot.position.x) === mousePos.x &&
    Math.round(pastedRoot.position.y) === mousePos.y,
  `粘贴根落在鼠标位置 (${Math.round(pastedRoot.position.x)},${Math.round(pastedRoot.position.y)})`
)
// 粘贴副本是游离结构（根 parentId=null）
check(pastedRoot.parentId === null, '粘贴根为游离（parentId=null）')

console.log(ok ? '\nALL PASSED' : '\nFAILED')
process.exit(ok ? 0 : 1)
