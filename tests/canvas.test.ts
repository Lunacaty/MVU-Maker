// 画布完整性：zod 反推后节点图结构正确（无孤儿、容器有子节点、根可达）
import {
  createEmptyCanvas,
  canvasToZodCode,
  zodToCanvas,
  walkFields,
  childrenOf,
  ROOT_NODE_ID,
  extractSchemaExprFromScript
} from '../src/shared/schema'
import type { SchemaNode } from '../src/shared/types'

const canvas = createEmptyCanvas()
const nodes: SchemaNode[] = [
  { id: 'a', name: '主角', type: 'object', parentId: ROOT_NODE_ID, position: { x: 0, y: 0 } },
  {
    id: 'b',
    name: '修为',
    type: 'number',
    parentId: 'a',
    numberConfig: { clampMin: 0, clampMax: 100 },
    position: { x: 0, y: 0 }
  },
  { id: 'c', name: '宗门', type: 'object', parentId: 'a', position: { x: 0, y: 0 } },
  { id: 'd', name: '名称', type: 'string', parentId: 'c', position: { x: 0, y: 0 } },
  { id: 'e', name: '背包', type: 'record', parentId: ROOT_NODE_ID, position: { x: 0, y: 0 } },
  { id: 'f', name: '数量', type: 'number', parentId: 'e', position: { x: 0, y: 0 } }
]
canvas.nodes.push(...nodes)

const code = canvasToZodCode(canvas)
const back = zodToCanvas(code)

let ok = true
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${msg}`)
  if (!cond) ok = false
}

// 根直接子
check(
  childrenOf(back, ROOT_NODE_ID).length === 2,
  `根直接子 2 (${childrenOf(back, ROOT_NODE_ID).length})`
)
// 主角容器子
const hero = childrenOf(back, ROOT_NODE_ID).find((n) => n.name === '主角')!
check(childrenOf(back, hero.id).length === 2, '主角子字段 2')
// 嵌套：宗门.名称
const sect = childrenOf(back, hero.id).find((n) => n.name === '宗门')!
check(childrenOf(back, sect.id)[0]?.name === '名称', '嵌套 宗门.名称')
// record 子
const bag = childrenOf(back, ROOT_NODE_ID).find((n) => n.name === '背包')!
check(childrenOf(back, bag.id)[0]?.name === '数量', 'record value 子字段')
// 路径
const paths = walkFields(back).map((p) => p.path)
check(
  paths.includes('主角.修为') &&
    paths.includes('主角.宗门.名称') &&
    paths.includes('背包.{键}.数量'),
  '路径含嵌套'
)
// 循环引用检测
const ids = new Set(back.nodes.map((n) => n.id))
check(
  back.nodes.every((n) => n.parentId === null || ids.has(n.parentId)),
  '无孤儿节点'
)

// 真实脚本（多行 z\n.object 链式 + prefault + record value）解析
const realScript = `
export const Schema = z.object({
  世界状态: z
    .object({
      当前时间: z.string().prefault('2025年5月12日 08:30'),
      当前世界: z.enum(['主世界', '西幻世界']).prefault('主世界'),
    })
    .prefault({}),
  状态: z
    .object({
      灵魂觉醒: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
      学会的魔法: z.record(z.string().describe('魔法名'), z.string().describe('魔法效果')).prefault({}),
    })
    .prefault({}),
  任务面板: z
    .object({
      任务列表: z
        .record(z.string().describe('任务名'), z.object({
          类型: z.enum(['主线', '支线']).prefault('支线'),
          状态: z.enum(['进行中', '已完成']).prefault('进行中'),
        }))
        .prefault({}),
    })
    .prefault({}),
  认识的人: z
    .record(z.string().describe('NPC姓名'), z.object({
      关系阶段: z.enum(['陌生', '初识']).prefault('初识'),
      对user的态度: z.string().prefault(''),
    }))
    .prefault({}),
});
`
const realExpr = extractSchemaExprFromScript(realScript)
const real = zodToCanvas(realExpr)
const realTop = childrenOf(real, ROOT_NODE_ID)
check(realTop.length === 4, `真实脚本顶层字段 4 (${realTop.length})`)
const ws = realTop.find((n) => n.name === '世界状态')
check(ws?.type === 'object' && childrenOf(real, ws!.id).length === 2, '世界状态 object + 2 子')
const magic = childrenOf(real, realTop.find((n) => n.name === '状态')!.id).find(
  (n) => n.name === '学会的魔法'
)
check(magic?.type === 'record', '学会的魔法 record 类型')
const taskList = childrenOf(real, realTop.find((n) => n.name === '任务面板')!.id).find(
  (n) => n.name === '任务列表'
)
check(
  taskList?.type === 'record' && childrenOf(real, taskList!.id).length === 2,
  '任务列表 record + 2 子'
)
const rp = childrenOf(real, realTop.find((n) => n.name === '认识的人')!.id)
check(rp[0]?.type === 'enum', 'record value 内 enum 类型')

console.log(ok ? '\nALL PASSED' : '\nFAILED')
process.exit(ok ? 0 : 1)
