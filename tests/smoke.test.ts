// 冒烟测试：PatchEngine 注入 + Validator + schema 编解码 + initvar 校验
import {
  createEmptyCanvas,
  canvasToZodCode,
  zodToCanvas,
  walkFields,
  childrenOf,
  ROOT_NODE_ID
} from '../src/shared/schema'
import { PatchEngine } from '../src/main/patch/engine'
import { Validator } from '../src/main/validator'
import { validateInitvar } from '../src/main/card/initvar'
import type { CharCardV2, CardProject, SchemaNode } from '../src/shared/types'

function makeTestCard(): CharCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '1.0',
    data: {
      name: '测试角色',
      description: '测试用',
      first_mes: '你好，我是测试角色。',
      alternate_greetings: [],
      character_book: { name: '测试', entries: [] },
      extensions: { regex_scripts: [], tavern_helper: { scripts: {}, variables: {} } }
    }
  }
}

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  OK  ${msg}`)
  else {
    console.error(`  FAIL  ${msg}`)
    failures++
  }
}

// ---- 1. Schema 编解码（节点图模型）----
console.log('[1] Schema 编解码')
{
  const canvas = createEmptyCanvas()
  const rootId = ROOT_NODE_ID
  const hero: SchemaNode = {
    id: 'n1',
    name: '主角',
    type: 'object',
    parentId: rootId,
    position: { x: 0, y: 0 }
  }
  const heroScore: SchemaNode = {
    id: 'n2',
    name: '好感度',
    type: 'number',
    parentId: 'n1',
    numberConfig: { clampMin: 0, clampMax: 100, prefault: 35 },
    position: { x: 0, y: 0 }
  }
  const bag: SchemaNode = {
    id: 'n3',
    name: '背包',
    type: 'record',
    parentId: rootId,
    position: { x: 0, y: 0 }
  }
  const bagCount: SchemaNode = {
    id: 'n4',
    name: '数量',
    type: 'number',
    parentId: 'n3',
    numberConfig: { prefault: 1 },
    position: { x: 0, y: 0 }
  }
  const readOnly: SchemaNode = {
    id: 'n5',
    name: '_只读',
    type: 'string',
    parentId: rootId,
    position: { x: 0, y: 0 }
  }
  const state: SchemaNode = {
    id: 'n6',
    name: '状态',
    type: 'enum',
    parentId: rootId,
    enumValues: ['健康', '轻伤'],
    position: { x: 0, y: 0 }
  }
  canvas.nodes.push(hero, heroScore, bag, bagCount, readOnly, state)

  const code = canvasToZodCode(canvas)
  assert(code.includes('z.object') && code.includes('_.clamp(v, 0, 100)'), 'zod clamp')
  assert(code.includes('z.enum(["健康", "轻伤"])'), 'zod enum')
  const back = zodToCanvas(code)
  assert(childrenOf(back, ROOT_NODE_ID).length === 4, `反推 4 顶层字段`)
  const heroBack = childrenOf(back, ROOT_NODE_ID).find((n) => n.name === '主角')
  assert(heroBack?.type === 'object', '反推 object 类型')
  assert(childrenOf(back, heroBack!.id)[0]?.numberConfig?.clampMax === 100, '反推 clamp')
  const paths = walkFields(back).map((p) => p.path)
  assert(paths.includes('主角.好感度') && paths.includes('背包.{键}'), '路径遍历')
}

// ---- 1.5 record 标量 value 往返（如 NPC: z.record(z.string().describe('NPC名称'), z.string().describe('NPC介绍'))）----
console.log('[1.5] record 标量 value 往返')
{
  const code = `z.object({
  NPC: z.record(z.string().describe('NPC名称'), z.string().describe('NPC介绍')).prefault({}),
  计数: z.record(z.string().describe('物品名'), z.coerce.number().prefault(0)).prefault({})
})`
  const canvas = zodToCanvas(code)
  const npc = childrenOf(canvas, ROOT_NODE_ID).find((n) => n.name === 'NPC')
  assert(npc?.type === 'record', 'NPC 反推为 record')
  const npcValue = childrenOf(canvas, npc!.id).find((n) => n.isRecordValue)
  assert(
    !!npcValue && npcValue.type === 'string',
    'record 标量 value 生成 isRecordValue 子节点(string)'
  )
  assert(npcValue?.describe === 'NPC介绍', 'value 子节点保留 describe')
  assert(npc?.recordKeyDescribe === 'NPC名称', 'record key 保留描述')
  const round = canvasToZodCode(canvas)
  assert(
    round.includes('z.record(z.string().describe("NPC名称"), z.string().describe("NPC介绍"))'),
    '标量 value 往返输出正确'
  )
  const counter = childrenOf(canvas, ROOT_NODE_ID).find((n) => n.name === '计数')
  const counterValue = childrenOf(canvas, counter!.id).find((n) => n.isRecordValue)
  assert(!!counterValue && counterValue.type === 'number', 'record number 标量 value 往返')
  const round2 = canvasToZodCode(canvas)
  assert(
    round2.includes('z.record(z.string().describe("物品名"), z.coerce.number().prefault(0))'),
    'number value 往返输出（含 prefault）'
  )
}

// ---- 2. PatchEngine 注入 MVU ----
console.log('[2] PatchEngine 注入')
{
  const card = makeTestCard()
  const canvas = createEmptyCanvas()
  const mk = (): PatchEngine =>
    new PatchEngine({
      openings: [{ key: 'main', text: card.data.first_mes, type: 'mixed' }],
      initvarYaml: '主角:\n  好感度: 35\n',
      schemaCode: canvasToZodCode(canvas),
      statusBarHtml: '<!doctype html><html><body>statusbar</body></html>',
      createCardHtml: '<!doctype html><html><body>create</body></html>',
      updateRulesYaml: '变量更新规则: {}',
      outputFormatYaml: '输出格式: {}',
      variableListContent: '变量列表'
    })
  const engine = mk()
  engine.applyCreateCard(card)
  engine.applyOpenings(card)
  engine.applyMvu(card)
  engine.applyStatusBar(card)

  const scripts = card.data.extensions!.tavern_helper!.scripts
  assert(!!scripts['MVU'] && scripts['MVU'].content.includes('MagVarUpdate'), 'MVU 脚本')
  assert(!!scripts['Zod'], 'Zod 脚本')
  const entries = Object.values(card.data.character_book!.entries)
  assert(entries.length === 4, `世界书 4 条目 (${entries.length})`)
  assert(
    entries.some((e) => e.comment === '[InitVar]请勿打开' && e.enabled === false),
    '[InitVar] 禁用'
  )
  assert(card.data.first_mes.includes('<StatusPlaceHolderImpl/>'), '状态栏占位符')
  assert(card.data.first_mes.includes('<CreateCardPlaceHolder/>'), '创建卡片占位符')
  assert(card.data.extensions!.regex_scripts!.length === 4, '正则 4 条')

  const engine2 = mk()
  engine2.applyMvu(card)
  engine2.applyStatusBar(card)
  assert(Object.keys(card.data.character_book!.entries).length === 4, '幂等：条目')
  assert(card.data.extensions!.regex_scripts!.length === 4, '幂等：正则')
}

// ---- 3. Validator ----
console.log('[3] Validator')
{
  const card = makeTestCard()
  card.data.first_mes += '\n\n<StatusPlaceHolderImpl/>'
  const project: CardProject = {
    card: { path: 'test.json', format: 'json', json: card },
    schemaCanvas: createEmptyCanvas(),
    openings: [{ key: 'main', text: card.data.first_mes, type: 'text' }],
    regexes: [],
    worldbookEntries: [],
    scripts: {},
    mvuDetected: true,
    statusBarHtml: '',
    createCardHtml: '',
    beautifyEnabled: false
  }
  const report = new Validator(project).run()
  assert(
    report.checks.some((c) => c.name === '结构合法' && c.passed),
    '结构合法'
  )
}

// ---- 4. initvar 校验（jiti）----
console.log('[4] initvar 校验')
;(async () => {
  const canvas = createEmptyCanvas()
  const hero: SchemaNode = {
    id: 'g1',
    name: '主角',
    type: 'object',
    parentId: ROOT_NODE_ID,
    position: { x: 0, y: 0 }
  }
  canvas.nodes.push(hero)
  canvas.nodes.push({
    id: 'g1f',
    name: '好感度',
    type: 'number',
    parentId: 'g1',
    numberConfig: { clampMin: 0, clampMax: 100, prefault: 35 },
    position: { x: 0, y: 0 }
  })
  const code = canvasToZodCode(canvas)
  const good = await validateInitvar(code, '主角:\n  好感度: 50\n')
  assert(good.ok, `initvar 合法通过 (${JSON.stringify(good.errors).slice(0, 80)})`)
  const bad = await validateInitvar(code, '主角:\n  好感度: 不是数字\n')
  assert(!bad.ok, 'initvar 非法被拒')

  console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
