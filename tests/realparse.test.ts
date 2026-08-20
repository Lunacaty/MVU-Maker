// 真实脚本解析回归：多行 z\n.object 链式 + prefault + record value 嵌套
import {
  zodToCanvas,
  canvasToZodCode,
  childrenOf,
  ROOT_NODE_ID,
  walkFields,
  extractSchemaExprFromScript
} from '../src/shared/schema'

const script = `
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  世界状态: z
    .object({
      当前时间: z.string().prefault('2025年5月12日 08:30'),
      当前所处位置: z.string().prefault('夜见原·家中'),
      当前世界: z.enum(['主世界', '西幻世界']).prefault('主世界'),
      当前幕: z
        .enum([
          '第一幕_失而复得',
          '第二幕_日常与隐瞒',
          '第三幕_变强与身世',
          '第四幕_裂隙',
          '第五幕_异端与复仇',
          '终幕_信任',
        ])
        .prefault('第一幕_失而复得'),
    })
    .prefault({}),
  状态: z
    .object({
      灵魂觉醒: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
      记忆恢复: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
      控制度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
      怀疑度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
      学会的魔法: z.record(z.string().describe('魔法名'), z.string().describe('魔法效果')).prefault({}),
    })
    .prefault({}),
  苏小雪状态: z
    .object({
      健康值: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(60),
      当前想法: z.string().prefault(''),
    })
    .prefault({}),
  任务面板: z
    .object({
      任务列表: z
        .record(z.string().describe('任务名'), z.object({
          类型: z.enum(['主线', '支线', '日常', '临时']).prefault('支线'),
          详细: z.string().prefault(''),
          目标: z.string().prefault(''),
          奖励: z.string().prefault(''),
          状态: z.enum(['进行中', '已完成', '已放弃']).prefault('进行中'),
        }))
        .prefault({}),
    })
    .prefault({}),
  外部压力: z
    .object({
      血液渴求度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(20),
      金钱: z.coerce.number().transform(v => _.clamp(v, 0, 9999999)).prefault(15000),
    })
    .prefault({}),
  认识的人: z
    .record(z.string().describe('NPC姓名'), z.object({
      关系阶段: z.enum(['陌生', '初识', '熟识', '固定血源']).prefault('初识'),
      上次经历: z.string().prefault(''),
      对user的态度: z.string().prefault(''),
    }))
    .prefault({}),
});

$(() => {
  registerMvuSchema(Schema);
})
`

let ok = true
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${msg}`)
  if (!cond) ok = false
}

const expr = extractSchemaExprFromScript(script)
check(expr.length > 1000, `提取表达式 len=${expr.length}`)

const canvas = zodToCanvas(expr)
const top = childrenOf(canvas, ROOT_NODE_ID)
check(top.length === 6, `顶层字段 6 (${top.length})`)

check(
  top.some((n) => n.name === '世界状态' && n.type === 'object'),
  '世界状态=object'
)
check(
  top.some((n) => n.name === '认识的人' && n.type === 'record'),
  '认识的人=record'
)

const ws = top.find((n) => n.name === '世界状态')!
check(childrenOf(canvas, ws.id).length === 4, '世界状态 4 子')
const currentWorld = childrenOf(canvas, ws.id).find((n) => n.name === '当前世界')!
check(
  currentWorld.type === 'enum' && currentWorld.enumPrefault === '主世界',
  '当前世界 enum+prefault'
)

const zt = top.find((n) => n.name === '状态')!
const magic = childrenOf(canvas, zt.id).find((n) => n.name === '学会的魔法')!
check(magic.type === 'record', '学会的魔法=record')

const tp = top.find((n) => n.name === '任务面板')!
const taskList = childrenOf(canvas, tp.id).find((n) => n.name === '任务列表')!
check(taskList.type === 'record', '任务列表=record')
check(
  childrenOf(canvas, taskList.id).length === 1 &&
    childrenOf(canvas, taskList.id)[0]?.type === 'object',
  '任务列表 object value → 唯一 object 子节点'
)

const rp = top.find((n) => n.name === '认识的人')!
check(
  childrenOf(canvas, rp.id).length === 1 && childrenOf(canvas, rp.id)[0]?.type === 'object',
  '认识的人 object value → 唯一 object 子节点'
)

// 路径全貌（object value 挂在 record 下的 value 子节点，路径带 .value）
const paths = walkFields(canvas).map((p) => p.path)
check(
  paths.includes('世界状态.当前幕') &&
    paths.includes('任务面板.任务列表.{键}.value.类型') &&
    paths.includes('认识的人.{键}.value.对user的态度'),
  '嵌套路径完整'
)

// 往返：重新生成 zod 再反推应一致
const code2 = canvasToZodCode(canvas)
const canvas2 = zodToCanvas(code2)
check(childrenOf(canvas2, ROOT_NODE_ID).length === 6, '往返顶层 6')

// enum prefault 往返保留
const ws2 = childrenOf(canvas2, ROOT_NODE_ID).find((n) => n.name === '世界状态')!
const cw2 = childrenOf(canvas2, ws2.id).find((n) => n.name === '当前世界')!
check(cw2.type === 'enum' && cw2.enumPrefault === '主世界', '往返 enum prefault 保留')

console.log(ok ? '\nALL PASSED' : '\nFAILED')
process.exit(ok ? 0 : 1)
