// 自动布局验证：读取脚本后成员应展开（不重叠），结构树状
import {
  zodToCanvas,
  childrenOf,
  ROOT_NODE_ID,
  getNode,
  containerSlots,
  memberPosition,
  subtreeSpan,
  isContainer
} from '../src/shared/schema'

let ok = true
function check(cond: boolean, msg: string): void {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${msg}`)
  if (!cond) ok = false
}

const code = `z.object({
  主角: z.object({
    修为: z.coerce.number().transform(v => _.clamp(v, 0, 100)).prefault(0),
    宗门: z.object({
      名称: z.string().prefault(''),
      声望: z.coerce.number().prefault(0),
    }),
  }),
  背包: z.record(z.string().describe('键'), z.object({
    数量: z.coerce.number().prefault(1),
  })),
  状态: z.enum(['健康', '受伤']).prefault('健康'),
})`

const canvas = zodToCanvas(code)
const root = getNode(canvas, ROOT_NODE_ID)!

// 根成员展开且不重叠
const top = childrenOf(canvas, ROOT_NODE_ID)
check(top.length === 3, `顶层 3 个 (${top.length})`)
const ys = top.map((n) => n.position.y)
check(ys[1] - ys[0] !== 0 && ys[2] - ys[1] !== 0, `顶层成员竖直展开 (${ys.join(',')})`)
check(ys[0] !== ys[1] && ys[1] !== ys[2], '顶层成员互不重叠')

// 嵌套容器成员也展开
const hero = top.find((n) => n.name === '主角')!
const heroKids = childrenOf(canvas, hero.id)
check(heroKids.length === 2, `主角 2 子 (${heroKids.length})`)
const heroYs = heroKids.map((n) => n.position.y)
check(heroYs[0] !== heroYs[1], '主角子成员互不重叠')

const sect = heroKids.find((n) => n.name === '宗门')!
const sectKids = childrenOf(canvas, sect.id)
check(sectKids.length === 2, `宗门 2 子 (${sectKids.length})`)

// 成员位置与算法 memberPosition 一致（说明布局按算法摆放）
const heroSlot = containerSlots(canvas, ROOT_NODE_ID).find((s) => s.childId === hero.id)!
const algoPos = memberPosition(canvas, root, heroSlot)
check(
  Math.round(hero.position.x) === Math.round(algoPos.x) &&
    Math.round(hero.position.y) === Math.round(algoPos.y),
  `成员位置=算法位置 (${Math.round(hero.position.x)},${Math.round(hero.position.y)})`
)

// record value 成员展开
const bag = top.find((n) => n.name === '背包')!
const bagKids = childrenOf(canvas, bag.id)
check(bagKids.length === 1, `背包 value 1 子`)

// 子树跨度：主角(含宗门嵌套)跨度应覆盖其成员竖直范围
const span = subtreeSpan(canvas, hero.id)
const heroKidsSpan = heroKids.reduce((a, c) => a + subtreeSpan(canvas, c.id), 0) + 76
check(span >= heroKidsSpan, `主角子树跨度覆盖成员 (${span}>=${heroKidsSpan})`)

// 同级容器不互相重叠：主角(有2个嵌套成员)与背包(有1个value成员)的竖直区间不交叠
function yRange(id: string): { top: number; bottom: number } {
  const n = getNode(canvas, id)
  if (!n) return { top: 0, bottom: 0 }
  const h = isContainer(n) ? 92 : 44
  const members = childrenOf(canvas, id)
  if (members.length === 0) return { top: n.position.y, bottom: n.position.y + h }
  const ranges = members.map((c) => yRange(c.id))
  return {
    top: Math.min(n.position.y, ...ranges.map((r) => r.top)),
    bottom: Math.max(n.position.y + h, ...ranges.map((r) => r.bottom))
  }
}
const heroRange = yRange(hero.id)
const bagRange = yRange(bag.id)
check(
  heroRange.bottom < bagRange.top,
  `主角与背包竖直区间不交叠 (${heroRange.bottom}<${bagRange.top})`
)

console.log(ok ? '\nALL PASSED' : '\nFAILED')
process.exit(ok ? 0 : 1)
