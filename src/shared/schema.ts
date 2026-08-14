// Schema 画布 ↔ zod 代码 双向编解码（纯逻辑，无 node 依赖）
// 画布模型：扁平节点图。每个节点是一个字段（SchemaNode），
// 通过 parentId 构成父子树；object/record 类型字段是容器，拥有子节点。
import type { SchemaCanvas, SchemaNode } from './types'
import { ROOT_NODE_ID } from './types'
import { stringify } from 'yaml'

export { ROOT_NODE_ID }

export function newId(prefix = 'id'): string {
  const rand = Math.random().toString(16).slice(2, 10)
  const time = Date.now().toString(16).slice(-6)
  return `${prefix}_${time}${rand}`
}

export function createEmptyCanvas(): SchemaCanvas {
  return {
    nodes: [
      {
        id: ROOT_NODE_ID,
        name: 'Schema',
        type: 'root',
        parentId: null,
        position: { x: 40, y: 40 }
      }
    ]
  }
}

export function isContainer(node: SchemaNode): boolean {
  return node.type === 'object' || node.type === 'record' || node.type === 'root'
}

/**
 * 从画布生成 initvar 骨架数据：所有字段取默认空值（不需要 LLM）：
 *   string → stringPrefault ?? ''；number → numberConfig.prefault ?? 0；boolean → booleanPrefault ?? false；
 *   enum → enumPrefault ?? 首值；object → 递归子字段；record → {}；union/其他 → stringPrefault ?? ''
 * 字段名去掉 _/$ 前缀（MVU 变量名前缀规则），与 zod 代码生成一致。
 */
export function canvasToInitvarData(canvas: SchemaCanvas): Record<string, unknown> {
  const build = (parentId: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const f of childrenOf(canvas, parentId)) {
      const key = f.name.replace(/^[_$]/, '')
      switch (f.type) {
        case 'object':
          out[key] = build(f.id)
          break
        case 'record':
          out[key] = {}
          break
        case 'number':
          out[key] = f.numberConfig?.prefault ?? 0
          break
        case 'boolean':
          out[key] = f.booleanPrefault ?? false
          break
        case 'enum':
          out[key] = f.enumPrefault ?? f.enumValues?.[0] ?? ''
          break
        default:
          out[key] = f.stringPrefault ?? ''
      }
    }
    return out
  }
  return build(ROOT_NODE_ID)
}

/** initvar YAML：根据 Schema 结构自动生成的默认空值（注入 [InitVar] 世界书条目用） */
export function canvasToInitvarYaml(canvas: SchemaCanvas): string {
  return stringify(canvasToInitvarData(canvas))
}

/** 能收子节点：object/record/root/union（union 的子节点 = 可选类型） */
export function canHaveChildren(node: SchemaNode): boolean {
  return isContainer(node) || node.type === 'union'
}

export function getNode(canvas: SchemaCanvas, id: string): SchemaNode | undefined {
  return canvas.nodes.find((n) => n.id === id)
}

export function childrenOf(canvas: SchemaCanvas, parentId: string): SchemaNode[] {
  return canvas.nodes.filter((n) => n.parentId === parentId)
}

export function parentOf(canvas: SchemaCanvas, node: SchemaNode): SchemaNode | undefined {
  return node.parentId ? getNode(canvas, node.parentId) : undefined
}

// ---------- 容器连接槽位（水平树状布局） ----------

export const CONTAINER_SIZE = 92 // 容器圆形节点直径
export const RECT_HEIGHT = 44 // 普通字段矩形高度
export const TRUNK_LEN = 60 // 主干：容器右缘中心向右延伸长度
export const LINK_LEN = 90 // 分野后水平段长度（接到成员左缘）
export const SNAP_RADIUS = 44 // 拖到虚线末端吸附判定半径
export const MEMBER_GAP = 76 // 成员竖直间距

export interface ContainerSlot {
  childId: string | null // null = 未连接的空虚线槽位
  yOffset: number // 相对主干中心线的竖直偏移（正=下，负=上）
}

/**
 * 水平树状槽位布局：
 * 所有线从容器右缘中心同一点出发 → 水平向右 TRUNK_LEN（主干）→ 从该点竖直分野 → 水平向右 LINK_LEN 接到成员。
 *
 * 成员槽位的 yOffset = **线末端相对容器主干中心的竖直偏移**（与 memberPosition/slotEndPos 一致）。
 * 由成员当前位置反推（成员拼接时被锚定到虚线位置，之后保持不动，不随成员数量重排）。
 * 空闲虚线始终在最下方成员之下。
 */
export function containerSlots(canvas: SchemaCanvas, containerId: string): ContainerSlot[] {
  const container = getNode(canvas, containerId)
  if (!container) return []
  const children = childrenOf(canvas, containerId)
  const trunkY = container.position.y + nodeHeight(container) / 2

  // 成员线末端 y = 成员中心 y；yOffset = 中心 - trunkY
  const slots: ContainerSlot[] = children.map((c) => ({
    childId: c.id,
    yOffset: c.position.y + nodeHeight(c) / 2 - trunkY
  }))

  // 空闲虚线：无成员时在主干水平处（0）；有成员时在最后成员完整区域之下（中心 + 半高 + 间距）
  let freeOffset = 0
  if (children.length) {
    // 最后成员（线末端 y 最大的）
    const last = children.reduce((a, b) =>
      a.position.y + nodeHeight(a) / 2 >= b.position.y + nodeHeight(b) / 2 ? a : b
    )
    freeOffset = last.position.y + nodeHeight(last) / 2 - trunkY + MEMBER_GAP + RECT_HEIGHT
  }
  slots.push({ childId: null, yOffset: freeOffset })
  return slots
}

/** 主干起点（容器右缘中心，所有线共用同一出发点） */
export function slotStartPos(container: SchemaNode): { x: number; y: number } {
  const h = nodeHeight(container)
  return {
    x: container.position.x + h,
    y: container.position.y + h / 2
  }
}

/** 主干末端（分野点）：右缘中心 + 向右 TRUNK_LEN */
export function trunkEndPos(container: SchemaNode): { x: number; y: number } {
  const s = slotStartPos(container)
  return { x: s.x + TRUNK_LEN, y: s.y }
}

/** 槽位线末端（接到成员的点）：分野点竖直偏移 + 向右 LINK_LEN */
export function slotEndPos(container: SchemaNode, slot: ContainerSlot): { x: number; y: number } {
  const t = trunkEndPos(container)
  return { x: t.x + LINK_LEN, y: t.y + slot.yOffset }
}

/** 槽位线段：仅最后一段（分野后 → 成员）作为吸附判定目标 */
export function slotSegment(
  container: SchemaNode,
  slot: ContainerSlot
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const t = trunkEndPos(container)
  return { a: { x: t.x, y: t.y + slot.yOffset }, b: slotEndPos(container, slot) }
}

/** 成员固定位置（节点左上角坐标）：线末端中心再偏移成员自身半尺寸 */
export function memberPosition(
  canvas: SchemaCanvas,
  container: SchemaNode,
  slot: ContainerSlot
): { x: number; y: number } {
  const end = slotEndPos(container, slot)
  const child = slot.childId ? getNode(canvas, slot.childId) : null
  const h = child ? nodeHeight(child) : CONTAINER_SIZE
  // 成员左缘对准线末端 end.x（第三步统一向右延伸 LINK_LEN），竖直中心对准 end.y
  return {
    x: end.x,
    y: end.y - h / 2
  }
}

/** 收集节点子树（含自身）的所有 id（带环保护，防止 parentId 成环导致死循环） */
export function collectSubtree(canvas: SchemaCanvas, rootId: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const walk = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    result.push(id)
    for (const c of childrenOf(canvas, id)) walk(c.id)
  }
  walk(rootId)
  return result
}

// ---------- 画布 → zod ----------

/** record 的 key 表达式：默认 z.string()，可记录描述（如 'NPC名称'） */
function recordKeyCode(node: SchemaNode): string {
  const base = node.recordKeyType === 'number' ? 'z.coerce.number()' : 'z.string()'
  const d = node.recordKeyDescribe
    ? `.describe(${JSON.stringify(node.recordKeyDescribe)})`
    : ".describe('键')"
  return base + d
}

function nodeToZod(canvas: SchemaCanvas, node: SchemaNode, indent = 2): string {
  const describe = node.describe ? `.describe(${JSON.stringify(node.describe)})` : ''
  const members = childrenOf(canvas, node.id)
  const pad = ' '.repeat(indent)
  switch (node.type) {
    case 'object':
    case 'record':
    case 'root': {
      // record：key（默认 string）+ value（标量 value 子节点优先，否则 object 字段集合）
      const valueChild = node.type === 'record' ? members.find((m) => m.isRecordValue) : undefined
      const keyPrefix = node.type === 'record' ? `z.record(${recordKeyCode(node)}, ` : ''
      const suffix = node.type === 'record' ? ')' : ''
      let valueCode: string
      if (valueChild) {
        valueCode = nodeToZod(canvas, valueChild, indent + 2)
      } else {
        const inner = members.length
          ? members
              .map((m) => `${JSON.stringify(m.name)}: ${nodeToZod(canvas, m, indent + 2)}`)
              .join(',\n' + pad)
          : ''
        valueCode = `z.object({\n${pad}${inner}\n${' '.repeat(indent - 2)}}).prefault({})`
      }
      return `${keyPrefix}${valueCode}${suffix}${describe}`
    }
    case 'string': {
      let s = 'z.string()'
      if (node.stringPrefault !== undefined)
        s += `.prefault(${JSON.stringify(node.stringPrefault)})`
      return s + describe
    }
    case 'number': {
      let s = 'z.coerce.number()'
      if (node.numberConfig?.int) s += '.int()'
      if (node.numberConfig?.clampMin != null || node.numberConfig?.clampMax != null) {
        const min = node.numberConfig?.clampMin ?? -Infinity
        const max = node.numberConfig?.clampMax ?? Infinity
        s += `.transform(v => _.clamp(v, ${JSON.stringify(min)}, ${JSON.stringify(max)}))`
      }
      if (node.numberConfig?.prefault !== undefined)
        s += `.prefault(${JSON.stringify(node.numberConfig.prefault)})`
      return s + describe
    }
    case 'boolean': {
      let s = 'z.boolean()'
      if (node.booleanPrefault !== undefined) s += `.prefault(${node.booleanPrefault})`
      return s + describe
    }
    case 'enum': {
      const vals = node.enumValues ?? []
      const inner =
        vals.length === 1
          ? JSON.stringify(vals[0])
          : `[${vals.map((v) => JSON.stringify(v)).join(', ')}]`
      let s = `z.enum(${inner})`
      if (node.enumPrefault !== undefined && node.enumPrefault !== '')
        s += `.prefault(${JSON.stringify(node.enumPrefault)})`
      return s + describe
    }
    case 'union': {
      const inner = members.map((m) => nodeToZod(canvas, m, indent + 2)).join(', ')
      return `z.union([${inner}])` + describe
    }
  }
}

export function canvasToZodCode(canvas: SchemaCanvas): string {
  const root = getNode(canvas, ROOT_NODE_ID)
  if (!root) return 'z.object({  })'
  const members = childrenOf(canvas, ROOT_NODE_ID)
  const inner = members
    .map((m) => `${JSON.stringify(m.name)}: ${nodeToZod(canvas, m, 4)}`)
    .join(',\n    ')
  return `z.object({\n    ${inner}\n  })`
}

// ---------- zod → 画布（轻量反推） ----------

interface ZodAst {
  kind: 'object' | 'record' | 'enum' | 'coerce' | 'number' | 'string' | 'boolean' | 'union'
  fields?: { name: string; expr: string }[]
  recordValueAst?: ZodAst | null
  /** record value 的原始表达式文本（标量 value 时用于生成 isRecordValue 子节点） */
  recordValueExpr?: string
  /** record key 类型与描述 */
  recordKeyType?: 'string' | 'number'
  recordKeyDescribe?: string
  enumValues?: string[]
  int?: boolean
  describe?: string
  prefault?: unknown
  prefaultStr?: boolean
  clampMin?: number | null
  clampMax?: number | null
}

/** 从 s 的 start 位置开始，提取一对平衡括号（含 ()[]{} 与字符串）的结束下标（含结束符） */
function balancedEnd(s: string, start: number): number {
  const open = s[start]
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : ''
  if (!close) return -1
  let depth = 0
  let inString: string | null = null
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === inString) inString = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') inString = c
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 去掉 z.object(...) 的调用壳，返回内部参数文本 */
function objectArgs(e: string): string {
  const openIdx = e.indexOf('(')
  if (openIdx < 0) return ''
  const end = balancedEnd(e, openIdx)
  if (end < 0) return ''
  return e.slice(openIdx + 1, end)
}

function findTopLevelCommas(s: string): number[] {
  const positions: number[] = []
  let depth = 0
  let inString: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === inString) inString = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') inString = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) positions.push(i)
  }
  return positions
}

function splitTopLevel(s: string): string[] {
  const commas = findTopLevelCommas(s)
  const parts: string[] = []
  let start = 0
  for (const pos of [...commas, s.length]) {
    const part = s.slice(start, pos).trim()
    if (part) parts.push(part)
    start = pos + 1
  }
  return parts
}

function parseInner(inner: string): { name: string; expr: string }[] {
  return splitTopLevel(inner).map((part) => {
    let depth = 0
    let inString: string | null = null
    for (let i = 0; i < part.length; i++) {
      const c = part[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === inString) inString = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') inString = c
      else if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ':' && depth === 0) {
        return {
          name: part
            .slice(0, i)
            .trim()
            .replace(/^["']|["']$/g, ''),
          expr: part.slice(i + 1).trim()
        }
      }
    }
    return { name: part, expr: part }
  })
}

/** 在 expr 末尾查找 ".method(" 调用；若该调用括号平衡且为 expr 的最后部分，返回起始下标 */
function findTrailingCall(expr: string, method: string): number {
  const needle = `.${method}(`
  const idx = expr.lastIndexOf(needle)
  if (idx < 0) return -1
  const end = balancedEnd(expr, idx + needle.length - 1)
  if (end === expr.length - 1) return idx
  let searchFrom = idx - 1
  while (searchFrom > 0) {
    const earlier = expr.lastIndexOf(needle, searchFrom)
    if (earlier < 0) break
    const e2 = balancedEnd(expr, earlier + needle.length - 1)
    if (e2 === expr.length - 1) return earlier
    searchFrom = earlier - 1
  }
  return -1
}

function tryParseDescribe(expr: string): { expr: string; describe?: string } {
  const idx = findTrailingCall(expr, 'describe')
  if (idx < 0) return { expr }
  const call = expr.slice(idx)
  const args = objectArgs(call)
  return { expr: expr.slice(0, idx), describe: args.replace(/^['"`]|['"`]$/g, '') }
}

function tryParsePrefault(expr: string): {
  expr: string
  prefault?: unknown
  prefaultStr?: boolean
} {
  const idx = findTrailingCall(expr, 'prefault')
  if (idx < 0) return { expr }
  const raw = objectArgs(expr.slice(idx)).trim()
  // 纯数字字面量转成 number（.prefault(0) 用于 number 字段）；带引号/其它保留原样
  let prefault: unknown = raw
  if (/^[-+]?\d+(\.\d+)?$/.test(raw)) prefault = Number(raw)
  return {
    expr: expr.slice(0, idx),
    prefault,
    prefaultStr: /^['"`]/.test(raw)
  }
}

function tryParseClamp(expr: string): {
  expr: string
  clampMin: number | null
  clampMax: number | null
} {
  const idx = findTrailingCall(expr, 'transform')
  if (idx < 0) return { expr, clampMin: null, clampMax: null }
  const call = expr.slice(idx)
  const inner = objectArgs(call)
  const m = inner.match(/v\s*=>\s*_.clamp\(\s*v\s*,\s*([^,]+)\s*,\s*([^)]+)\)\s*$/)
  if (!m) return { expr, clampMin: null, clampMax: null }
  const num = (s: string): number | null => {
    const n = Number(s.trim())
    return isFinite(n) ? n : null
  }
  return {
    expr: expr.slice(0, idx),
    clampMin: num(m[1]),
    clampMax: num(m[2])
  }
}

function exprToAst(expr: string): ZodAst | null {
  let e = expr.trim()
  const { expr: e1, describe } = tryParseDescribe(e)
  e = e1
  const { expr: e2, prefault, prefaultStr } = tryParsePrefault(e)
  e = e2
  const { expr: e3, clampMin, clampMax } = tryParseClamp(e)
  e = e3
  // 规整 `z\n .object(...)` → `z.object(...)`（多行链式写法）
  e = e.replace(/^z\s*\n*\s*\./, 'z.')
  const withCommon = (partial: Omit<ZodAst, 'describe' | 'prefault'>): ZodAst => ({
    ...partial,
    describe,
    prefault,
    prefaultStr
  })

  if (e.startsWith('z.object')) {
    const inner = objectArgs(e)
    const brace = inner.trim().replace(/^{/, '').replace(/}$/, '')
    const fields = parseInner(brace)
    return withCommon({ kind: 'object', fields })
  }
  if (e.startsWith('z.record')) {
    const inner = objectArgs(e)
    const args = splitTopLevel(inner)
    let recordValueAst: ZodAst | null = null
    let recordValueExpr: string | undefined
    let recordKeyType: 'string' | 'number' = 'string'
    let recordKeyDescribe: string | undefined
    if (args.length >= 1) {
      const keyAst = exprToAst(args[0])
      recordKeyType = keyAst?.kind === 'number' || /number/i.test(args[0]) ? 'number' : 'string'
      recordKeyDescribe = tryParseDescribe(args[0]).describe
    }
    if (args.length >= 2) {
      recordValueAst = exprToAst(args[1])
      recordValueExpr = args[1]
    }
    return withCommon({
      kind: 'record',
      recordValueAst,
      recordValueExpr,
      recordKeyType,
      recordKeyDescribe
    })
  }
  if (e.startsWith('z.enum')) {
    const inner = objectArgs(e)
    const vals = splitTopLevel(inner.replace(/^\[/, '').replace(/\]$/, '')).map((v) =>
      v.replace(/^['"`]|['"`]$/g, '')
    )
    return withCommon({ kind: 'enum', enumValues: vals })
  }
  if (e.startsWith('z.coerce.number')) {
    return withCommon({ kind: 'number', int: e.includes('.int()'), clampMin, clampMax })
  }
  if (e.startsWith('z.boolean')) {
    return withCommon({ kind: 'boolean' })
  }
  if (e.startsWith('z.string')) {
    return withCommon({ kind: 'string' })
  }
  if (e.startsWith('z.union')) {
    return withCommon({ kind: 'union' })
  }
  return null
}

function makeNodeFromAst(
  canvas: SchemaCanvas,
  name: string,
  expr: string,
  parentId: string,
  slotPos: { x: number; y: number }
): SchemaNode {
  const ast = exprToAst(expr)
  const node: SchemaNode = {
    id: newId('f'),
    name,
    type: 'string',
    parentId,
    position: { x: slotPos.x + (canvas.nodes.length % 4) * 40, y: slotPos.y + 60 }
  }
  if (ast) {
    node.describe = ast.describe
    switch (ast.kind) {
      case 'object':
        node.type = 'object'
        break
      case 'record':
        node.type = 'record'
        break
      case 'enum':
        node.type = 'enum'
        node.enumValues = ast.enumValues ?? []
        node.enumPrefault = ast.prefaultStr
          ? String(ast.prefault).replace(/^['"`]|['"`]$/g, '')
          : undefined
        break
      case 'number':
        node.type = 'number'
        node.numberConfig = {
          int: ast.int,
          clampMin: ast.clampMin,
          clampMax: ast.clampMax,
          prefault: typeof ast.prefault === 'number' ? ast.prefault : undefined
        }
        break
      case 'boolean':
        node.type = 'boolean'
        node.booleanPrefault = ast.prefault === true
        break
      case 'union':
        node.type = 'union'
        break
      case 'coerce':
      case 'string':
      default:
        node.type = 'string'
        node.stringPrefault = ast.prefaultStr
          ? String(ast.prefault).replace(/^['"`]|['"`]$/g, '')
          : undefined
    }
  }
  canvas.nodes.push(node)

  // object/record 的子节点递归构建
  if (node.type === 'object' && ast?.kind === 'object') {
    for (const f of ast.fields ?? []) {
      makeNodeFromAst(canvas, f.name, f.expr, node.id, node.position)
    }
  }
  if (node.type === 'record' && ast?.kind === 'record') {
    node.recordKeyType = ast.recordKeyType ?? 'string'
    node.recordKeyDescribe = ast.recordKeyDescribe
    const valAst = ast.recordValueAst
    if (valAst?.kind === 'object') {
      for (const f of valAst.fields ?? []) {
        makeNodeFromAst(canvas, f.name, f.expr, node.id, node.position)
      }
    } else if (ast.recordValueExpr) {
      // 标量 value（string/number/boolean/enum 等）：生成一个 isRecordValue 子节点作为 value 槽位
      const valueChild = makeNodeFromAst(canvas, '', ast.recordValueExpr, node.id, node.position)
      valueChild.isRecordValue = true
    }
  }
  if (node.type === 'union' && ast?.kind === 'union') {
    // union 成员解析：z.union([...]) 里的表达式无法简单反推为具名字段，跳过
  }
  return node
}

/**
 * 从 zod 源码反推画布（节点图），并自动按水平树状布局展开。
 * code 形如 "z.object({ 白娅: z.object({...}) })"
 */
export function zodToCanvas(code: string): SchemaCanvas {
  const canvas = createEmptyCanvas()
  const ast = exprToAst(code)
  if (ast?.kind === 'object') {
    for (const f of ast.fields ?? []) {
      makeNodeFromAst(canvas, f.name, f.expr, ROOT_NODE_ID, getNode(canvas, ROOT_NODE_ID)!.position)
    }
  }
  layoutCanvas(canvas)
  return canvas
}

/** 节点自身高度 */
export function nodeHeight(node: SchemaNode): number {
  if (node.type === 'root') return 108
  if (isContainer(node)) return CONTAINER_SIZE
  return RECT_HEIGHT
}

/**
 * 子树竖直跨度：节点自身高度 与 其全部子孙竖直堆叠总高的较大者。
 * 容器额外预留 1 条空闲虚线（相当于 N+1 个成员），保证：
 *   - 同级对象之间留下空隙，虚线不会与下一个对象的字段重叠
 *   - 新字段拼接时虚线槽位有足够空间
 */
export function subtreeSpan(canvas: SchemaCanvas, id: string): number {
  const node = getNode(canvas, id)
  if (!node) return 0
  const children = childrenOf(canvas, id)
  if (!canHaveChildren(node)) return nodeHeight(node)
  if (children.length === 0) return nodeHeight(node) + MEMBER_GAP
  const stacked =
    children.reduce((acc, c) => acc + subtreeSpan(canvas, c.id), 0) + children.length * MEMBER_GAP // N 个成员之间 N-1 个间距 + 1 个虚线预留间距
  return Math.max(nodeHeight(node), stacked)
}

/** 重排容器成员（按子树跨度堆叠），保持容器锚点不动 */
export function relayoutContainer(canvas: SchemaCanvas, containerId: string): void {
  const container = getNode(canvas, containerId)
  if (!container) return
  const children = childrenOf(canvas, containerId)
  if (children.length === 0) return
  const spans = children.map((c) => subtreeSpan(canvas, c.id))
  const total = spans.reduce((a, b) => a + b, 0) + (children.length - 1) * MEMBER_GAP
  const trunkY = container.position.y + nodeHeight(container) / 2
  let top = trunkY - total / 2
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const cy = top + spans[i] / 2
    const slot: ContainerSlot = {
      childId: child.id,
      yOffset: cy - container.position.y - nodeHeight(container) / 2
    }
    child.position = memberPosition(canvas, container, slot)
    top += spans[i] + MEMBER_GAP
  }
}

/**
 * 自动布局：以根为锚点，递归为每个容器按子树跨度堆叠成员。
 * 成员若自身是容器则继续递归；游离节点不移动。
 */
export function layoutCanvas(canvas: SchemaCanvas): void {
  const root = getNode(canvas, ROOT_NODE_ID)
  if (!root) return
  root.position = { x: 40, y: 40 }
  layoutContainer(canvas, ROOT_NODE_ID)
}

/**
 * 结构变化后的整树重排：以根节点**当前位置**为锚点（不重置到 40,40），
 * 重新堆叠整棵树。任何增删/解绑导致某容器子树跨度变化时都必须整树重排，
 * 否则祖先容器按旧跨度计算出的兄弟槽位会与变化后的子树重叠/留空。
 */
export function relayoutTree(canvas: SchemaCanvas): void {
  const root = getNode(canvas, ROOT_NODE_ID)
  if (!root) return
  layoutContainer(canvas, ROOT_NODE_ID)
}

function layoutContainer(canvas: SchemaCanvas, containerId: string): void {
  const container = getNode(canvas, containerId)
  if (!container) return
  const children = childrenOf(canvas, containerId)
  if (children.length === 0) return

  // 每个孩子的子树跨度
  const spans = children.map((c) => subtreeSpan(canvas, c.id))
  const total = spans.reduce((a, b) => a + b, 0) + (children.length - 1) * MEMBER_GAP

  // 从容器主干中心上下堆叠：整体垂直居中
  const trunkY = container.position.y + nodeHeight(container) / 2
  let top = trunkY - total / 2

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const span = spans[i]
    const cy = top + span / 2
    const slot: ContainerSlot = {
      childId: child.id,
      yOffset: cy - container.position.y - nodeHeight(container) / 2
    }
    child.position = memberPosition(canvas, container, slot)
    if (canHaveChildren(child)) layoutContainer(canvas, child.id)
    top += span + MEMBER_GAP
  }
}

// ---------- 工具函数 ----------

/** 从酒馆助手 Zod 脚本内容提取 schema 表达式（"export const Schema = ..." 之后的部分） */
export function extractSchemaExprFromScript(content: string): string {
  const idx = content.indexOf('export const Schema = ')
  if (idx < 0) return ''
  const rest = content.slice(idx + 'export const Schema = '.length)
  let depth = 0
  let inString: string | null = null
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
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
        let end = i + 1
        while (end < rest.length && /[\s;]/.test(rest[end])) end++
        return rest.slice(0, end).trim().replace(/;+$/, '')
      }
    }
  }
  return rest.trim().replace(/;+$/, '')
}

export function walkFields(
  canvas: SchemaCanvas,
  parentId = ROOT_NODE_ID,
  parentPath = ''
): { path: string; node: SchemaNode }[] {
  const result: { path: string; node: SchemaNode }[] = []
  for (const child of childrenOf(canvas, parentId)) {
    const path = parentPath ? `${parentPath}.${child.name}` : child.name
    result.push({ path, node: child })
    if (child.type === 'object' || child.type === 'record') {
      const suffix = child.type === 'record' ? '.{键}' : ''
      result.push(...walkFields(canvas, child.id, path + suffix))
    }
  }
  return result
}
