// 端到端验证：用真实会话项目完整走 buildCardJson 合成 → 导出 PNG → ST 真实 read()
// 重点验证 character_book.entries 为数组（ST convertCharacterBook 的 forEach 契约）
import { readFile, writeFile, rm } from 'fs/promises'
import { PatchEngine } from '../src/main/patch/engine'
import { canvasToZodCode, createEmptyCanvas, childrenOf } from '../src/shared/schema'
import { replaceCharaChunk } from '../src/main/png/chunks'
import { stringify as stringifyYaml } from 'yaml'
import type { CardProject, CharCardV2 } from '../src/shared/types'

const SESSION = 'C:/Users/Erocatss/AppData/Roaming/mvu-maker/session-project.json'
const ST_PARSER = 'file:///D:/Game/MySillyTavern/src/character-card-parser.js'
const FALLBACK_SOURCE = 'E:/Pictures/Tavern/淫魔腐化~那淫魔竟然长得跟我妹妹一模一样！？.png'

// 与 ipc.ts skeletonFromCanvas 相同
function skeletonFromCanvas(canvas: CardProject['schemaCanvas']): Record<string, unknown> {
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
          out[key] = f.enumValues?.[0] ?? ''
          break
        default:
          out[key] = f.stringPrefault ?? ''
      }
    }
    return out
  }
  return build(canvas.rootId ?? createEmptyCanvas().rootId)
}

async function main(): Promise<void> {
  const project: CardProject = JSON.parse(await readFile(SESSION, 'utf-8'))
  console.log('卡片名:', project.card.json.data.name)
  console.log('card.path:', project.card.path || '(空，用源卡兜底)')
  const srcWb = project.card.json.data.character_book
  console.log(
    '源卡 character_book.entries:',
    srcWb
      ? Array.isArray(srcWb.entries)
        ? `array(${srcWb.entries.length})`
        : `object(${Object.keys(srcWb.entries ?? {}).length})`
      : '无'
  )
  console.log(
    '项目工作副本: 世界书',
    project.worldbookEntries.length,
    '条 / 正则',
    project.regexes.length,
    '条 / 脚本',
    Object.keys(project.scripts ?? {}).join(','),
    '/ 开场白',
    project.openings.length,
    '个'
  )

  // ===== 复制 buildCardJson =====
  const json: CharCardV2 = JSON.parse(JSON.stringify(project.card.json))
  const engine = new PatchEngine({
    openings: project.openings,
    initvarYaml: stringifyYaml(skeletonFromCanvas(project.schemaCanvas)),
    schemaCode: canvasToZodCode(project.schemaCanvas),
    updateRulesYaml: '',
    outputFormatYaml: '',
    variableListContent: ''
  })
  engine.applyOpeningInitvar()
  engine.applyOpenings(json)
  engine.applyWorldbookEntries(json, project.worldbookEntries)
  engine.applyRegexes(json, project.regexes)
  engine.applyScripts(json, project.scripts)

  const builtWb = json.data.character_book
  if (!builtWb) throw new Error('合成后无 character_book')
  const isArr = Array.isArray(builtWb.entries)
  console.log(
    '✅ 合成后 character_book.entries:',
    isArr
      ? `array(${builtWb.entries.length})`
      : `对象(${typeof builtWb.entries}) ← ST 会报 entries.forEach 错`
  )
  if (!isArr) throw new Error('修复失败：entries 不是数组')

  // ===== ST convertCharacterBook 契约（5501 行 forEach 的直接前提）=====
  builtWb.entries.forEach((entry: { id?: number }, index: number) => {
    if (entry.id === undefined) entry.id = index
  })
  const first = builtWb.entries[0]
  console.log(
    '✅ ST convertCharacterBook 契约通过（entries.forEach 可用），首条:',
    first?.comment?.slice(0, 20)
  )

  // ===== 酒馆助手脚本契约（JS-Slash-Runner：scripts 必须是数组，否则被静默丢弃）=====
  const thScripts = json.data.extensions?.tavern_helper?.scripts
  if (!Array.isArray(thScripts)) throw new Error('修复失败：tavern_helper.scripts 不是数组')
  console.log(
    '✅ tavern_helper.scripts 为数组:',
    thScripts.map((s) => `${s.name}(${s.enabled ? '启用' : '禁用'})`).join(', ')
  )
  for (const s of thScripts) {
    if (!s.name || !s.content)
      throw new Error(`脚本缺 name/content: ${JSON.stringify(s).slice(0, 80)}`)
  }

  // ===== MVU 条目位置契约（官方标准：atDepth=4 + depth 0/1/4 + order 200）=====
  const mvuEntries = builtWb.entries.filter(
    (e: { comment: string }) =>
      e.comment === '变量列表' ||
      e.comment.startsWith('[mvu_update]') ||
      e.comment.startsWith('[InitVar]')
  )
  for (const e of mvuEntries) {
    const pos = (e as { extensions?: { position?: number; depth?: number; order?: number } })
      .extensions
    console.log(
      `  ${e.comment.slice(0, 20).padEnd(22)} position=${pos?.position} depth=${pos?.depth} order=${pos?.order}`
    )
    if (pos?.position !== 4)
      throw new Error(`MVU 条目位置错误: ${e.comment} position=${pos?.position}（应为 4=atDepth）`)
  }

  // ===== 导出 PNG + ST 真实 read =====
  const sourcePath = project.card.path || FALLBACK_SOURCE
  const src = await readFile(sourcePath)
  const out = replaceCharaChunk(src, JSON.stringify(json, null, 2))
  const outPath = 'E:/Pictures/Tavern/_verify-worldbook.png'
  await writeFile(outPath, out)

  const { read: stRead } = await import(ST_PARSER)
  const stCard = JSON.parse(stRead(out))
  const stWb = stCard.data.character_book
  console.log(
    '✅ ST read() 导出文件 → 角色名:',
    stCard.data.name,
    '| entries:',
    Array.isArray(stWb?.entries) ? `array(${stWb.entries.length})` : typeof stWb?.entries
  )
  if (!Array.isArray(stWb?.entries)) throw new Error('ST 读出的 entries 仍非数组')
  stWb.entries.forEach((e: unknown, i: number) =>
    console.log('  条目', i, ':', (e as { comment?: string }).comment?.slice(0, 24))
  )
  // ST 读回后：scripts 数组 + MVU 条目位置仍须正确
  const stScripts = stCard.data.extensions?.tavern_helper?.scripts
  if (!Array.isArray(stScripts))
    throw new Error('ST 读出的 tavern_helper.scripts 非数组（酒馆助手会丢弃）')
  console.log(
    '✅ ST read() scripts:',
    stScripts
      .map((s: { name?: string; enabled?: boolean }) => `${s.name}(${s.enabled ? '启用' : '禁用'})`)
      .join(', ')
  )
  await rm(outPath, { force: true })
  console.log('全部验证通过 ✅')
}

main().catch((e) => {
  console.error('验证失败:', e)
  process.exit(1)
})
