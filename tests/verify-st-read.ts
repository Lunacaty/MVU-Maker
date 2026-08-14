// 一次性验证：用 SillyTavern 的真实 character-card-parser.read 检查导出兼容性
// 用法: npx tsx tests/verify-st-read.ts [png路径]
// 会读取指定 PNG（默认用户最近一次失败的导出），用 ST 同款逻辑读旧格式，
// 再用本工具的新格式(chara+ccv3 base64)重写后，用 ST 真实代码再读一次。
import { readFile, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { replaceCharaChunk, extractCharaJson } from '../src/main/png/chunks'

const ST_PARSER = 'file:///D:/Game/MySillyTavern/src/character-card-parser.js'

const target =
  process.argv[2] ??
  'E:/Pictures/Tavern/淫魔腐化~那淫魔竟然长得跟我妹妹一模一样！？-2026-08-14-09-14.png'

async function main(): Promise<void> {
  const { read: stRead } = await import(ST_PARSER)
  const buf = await readFile(target)

  // 1) ST 读旧导出（当前用户遇到"文件已损坏"的文件）
  let stOld: string
  try {
    stOld = stRead(buf)
    let oldJsonOk = false
    try {
      JSON.parse(stOld)
      oldJsonOk = true
    } catch (e) {
      console.log('❌ 旧导出：ST read() 后 JSON.parse 失败 →', String(e).slice(0, 100))
    }
    console.log(
      `旧导出：ST read() 返回片段=${JSON.stringify(stOld.slice(0, 40))} JSON解析=${oldJsonOk ? 'OK' : 'FAIL'}`
    )
  } catch (e) {
    console.log('❌ 旧导出：ST read() 直接抛错 →', String(e).slice(0, 100))
  }

  // 2) 用本工具新格式重写（chara+ccv3 base64，ST write 同款）
  const json = extractCharaJson(buf)
  if (!json) {
    console.log('❌ 无法从该文件提取卡片 JSON，无法验证')
    return
  }
  const newBuf = replaceCharaChunk(buf, json)
  const newPath = join(process.cwd(), '_verify-new-format.png')
  await writeFile(newPath, newBuf)

  // 3) ST 读新格式
  try {
    const stNew = stRead(newBuf)
    let name: string | null = null
    try {
      name = (JSON.parse(stNew) as { name?: string })?.name ?? null
      console.log(`✅ 新格式：ST read() + JSON.parse OK，卡片名=${name}`)
    } catch (e) {
      console.log('❌ 新格式：ST read() 后 JSON.parse 失败 →', String(e).slice(0, 100))
    }
    const myExtract = extractCharaJson(newBuf)
    console.log(
      `新格式：本工具提取=${myExtract ? (JSON.parse(myExtract) as { name?: string }).name : 'FAIL'}`
    )
  } catch (e) {
    console.log('❌ 新格式：ST read() 直接抛错 →', String(e).slice(0, 100))
  }
  await rm(newPath, { force: true })
}

main().catch((e) => {
  console.error('验证脚本失败:', e)
  process.exit(1)
})
