// PNG 读卡冒烟：构造一个含 chara chunk 的 PNG，验证 CardReader 能读取 + 导出写回
import { readCard } from '../src/main/card/reader'
import { makeTestCard } from './helpers/testCard'
import { writeFile, mkdir, rm, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import encode from 'png-chunks-encode'
import {
  makeTextChunk,
  extractCharaJson,
  replaceCharaChunk,
  stExtractCharaText
} from '../src/main/png/chunks'
import { exportCard } from '../src/main/png/packer'

// 用 png-chunks-encode 自动计算 CRC 与签名，构造合法 PNG
function makePngWithChara(jsonText: string, keyword = 'chara'): Buffer {
  const chunks = [
    {
      type: 'IHDR',
      name: 'IHDR',
      data: Buffer.concat([Buffer.alloc(4), Buffer.alloc(4), Buffer.from([8, 6, 0, 0, 0])])
    },
    { type: 'IDAT', name: 'IDAT', data: Buffer.alloc(0) },
    makeTextChunk(keyword, jsonText),
    { type: 'IEND', name: 'IEND', data: Buffer.alloc(0) }
  ]
  return Buffer.from(encode(chunks))
}

function walkTypes(b: Buffer): string[] {
  const types: string[] = []
  let o = 8
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o)
    types.push(b.toString('latin1', o + 4, o + 8))
    o = o + 8 + len + 4
    if (types[types.length - 1] === 'IEND') break
  }
  return types
}

async function main(): Promise<void> {
  const dir = join(tmpdir(), 'mvu-png-test')
  await mkdir(dir, { recursive: true })
  const card = makeTestCard()
  const jsonText = JSON.stringify(card, null, 2)

  const withChara = makePngWithChara(jsonText)
  const pngPath = join(dir, 'test.png')
  await writeFile(pngPath, withChara)

  // 直接验证 extractCharaJson
  const direct = extractCharaJson(withChara)
  console.log('direct extract:', direct?.slice(0, 60))

  const result = await readCard(pngPath)
  console.log('PNG 读取成功:', result.format, result.json.data.name)
  if (result.format !== 'png') throw new Error('格式应为 png')
  if (result.json.data.name !== '测试角色') throw new Error('角色名不符')

  // 导出写回：改角色名再写回，验证 UTF-8 chara 保真
  result.json.data.name = '增强后角色'
  const outPng = join(dir, 'out.png')
  await exportCard(result.json, 'png', outPng, withChara)
  const outBuf = await readFile(outPng)
  const roundtrip = extractCharaJson(outBuf)
  if (!roundtrip || !roundtrip.includes('增强后角色')) throw new Error('导出 PNG chara 未保真')
  // ST 同款读取：导出文件必须能被 ST 的 base64 解码逻辑还原（这是之前 ST 报"文件已损坏"的根因）
  if (!stExtractCharaText(outBuf)?.includes('增强后角色'))
    throw new Error('导出 PNG 无法被 SillyTavern 同款逻辑读取')
  console.log('PNG 导出写回 OK')

  // 回归：charA keyword 非 'chara'（如 'Character'）的卡，替换导出后必须能读到新内容
  const nonStd = makePngWithChara(jsonText, 'Character')
  if (!extractCharaJson(nonStd)?.includes('测试角色'))
    throw new Error('非标准 keyword 兜底读取失败')
  const renamed = JSON.stringify({ ...card, data: { ...card.data, name: '非标准KEYWORD替换' } })
  const replaced = replaceCharaChunk(nonStd, renamed)
  const reread = extractCharaJson(replaced)
  if (!reread?.includes('非标准KEYWORD替换')) throw new Error('非标准 keyword 替换后读取失败')
  const types = walkTypes(replaced)
  const iendIdx = types.indexOf('IEND')
  const preIendText = iendIdx < 0 ? [] : types.slice(0, iendIdx).filter((t) => t === 'tEXt')
  if (iendIdx < 0 || preIendText.length !== 2)
    throw new Error('替换后应只剩 chara+ccv3 两个 tEXt 且位于 IEND 之前')
  if (replaced.includes('Character')) throw new Error('旧的非标准 chunk 应被移除')
  // ST 同款读取：base64 解码 chara/ccv3 必须能还原出新 JSON（裸 JSON 会被 ST 解成乱码）
  const stText = stExtractCharaText(replaced)
  if (!stText?.includes('非标准KEYWORD替换'))
    throw new Error('SillyTavern 同款读取(base64 解码)失败')
  console.log('PNG 非标准 keyword 替换 OK')

  // 严格校验（模拟 SillyTavern 解析器）：每个 chunk 的 CRC 必须正确、IDAT 字节与源一致
  const strict = await import('./helpers/pngStrict')
  if (!strict.crc32Validate(replaced)) throw new Error('导出 PNG 存在 CRC 错误（酒馆会判损坏）')
  if (!strict.idatEquals(withChara, replaced)) throw new Error('导出 PNG 的像素(IDAT)被破坏')
  console.log('PNG 严格校验（CRC / 像素一致）OK')

  await rm(dir, { recursive: true, force: true })
  console.log('PNG 读卡/写卡 OK')
}

main().catch((e) => {
  console.error('PNG 读卡失败:', e)
  process.exit(1)
})
