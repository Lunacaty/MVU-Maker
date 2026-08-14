// PNG 文本 chunk 处理：宽容解析，支持 tEXt / iTXt / zTXt，UTF-8 内容，不强制 CRC 校验
// 背景：SillyTavern 的 chara 通常存为 tEXt，但部分卡是 iTXt/zTXt 或 CRC 不规范。
// 不做 CRC 强校验，扫描所有文本类 chunk 找 chara 关键字；找不到则兜底找能解析为 chara_card_v2 的。
import zlib from 'zlib'

export const CHARA_KEYWORD = 'chara'

export function isPng(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47
}

interface RawChunk {
  type: string
  data: Buffer
  /** 该 chunk 在源 buffer 中的字节区间（含 CRC），用于原样拷贝 */
  start: number
  end: number
}

/**
 * 手动遍历 chunk，不校验 CRC，容错（某些卡 CRC 不规范或带非标准 chunk）。
 * 记录每个 chunk 的原始字节区间；遇到长度越界立即停止，剩余字节由调用方原样保留。
 */
function walkChunks(buffer: Buffer): RawChunk[] {
  const chunks: RawChunk[] = []
  let offset = 8 // 跳过 PNG 签名
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const typeStart = offset + 4
    if (typeStart + 4 > buffer.length) break
    const type = buffer.toString('latin1', typeStart, typeStart + 4)
    const dataStart = typeStart + 4
    const dataEnd = dataStart + length
    const end = dataEnd + 4 // 含 CRC
    if (end > buffer.length) break // 长度越界：停止，剩余字节原样保留
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd), start: offset, end })
    offset = end
    if (type === 'IEND') break
  }
  return chunks
}

/** 解析文本 chunk 内容为 keyword+text；支持 tEXt / iTXt / zTXt */
function decodeTextChunk(chunk: RawChunk): { keyword: string; text: string } | null {
  try {
    if (chunk.type === 'tEXt') {
      const nul = chunk.data.indexOf(0)
      if (nul < 0) return null
      return {
        keyword: chunk.data.subarray(0, nul).toString('latin1'),
        text: chunk.data.subarray(nul + 1).toString('utf-8')
      }
    }
    if (chunk.type === 'zTXt') {
      const nul = chunk.data.indexOf(0)
      if (nul < 0) return null
      const keyword = chunk.data.subarray(0, nul).toString('latin1')
      // zTXt: keyword\0 compressionMethod(1 byte) compressed-data
      const compressed = chunk.data.subarray(nul + 2)
      const text = zlib.inflateSync(compressed).toString('utf-8')
      return { keyword, text }
    }
    if (chunk.type === 'iTXt') {
      // iTXt: keyword\0 compressionFlag(1) compressionMethod(1) language(0) translatedKeyword(0) text
      const nul = chunk.data.indexOf(0)
      if (nul < 0) return null
      const keyword = chunk.data.subarray(0, nul).toString('latin1')
      const compFlag = chunk.data[nul + 1]
      let textBuf = chunk.data.subarray(nul + 4)
      // 跳过 language 与 translated keyword 的 \0
      for (let i = 0; i < 2; i++) {
        const n2 = textBuf.indexOf(0)
        if (n2 < 0) return { keyword, text: '' }
        textBuf = textBuf.subarray(n2 + 1)
      }
      const text =
        compFlag === 1 ? zlib.inflateSync(textBuf).toString('utf-8') : textBuf.toString('utf-8')
      return { keyword, text }
    }
  } catch {
    return null
  }
  return null
}

/** 尝试把 chunk 文本解析为卡片 JSON（支持直接 JSON / base64 编码，v2/v3） */
function parseCardJson(text: string): string | null {
  const SUPPORTED = ['chara_card_v2', 'chara_card_v3']
  const trimmed = text.trim()
  if (!trimmed) return null
  // 直接 JSON
  try {
    const json = JSON.parse(trimmed)
    if (SUPPORTED.includes(json?.spec) && json?.data) return trimmed
  } catch {
    // 忽略
  }
  // base64 编码（部分导出工具把 chara JSON base64 后存入 tEXt）
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8')
    const json = JSON.parse(decoded)
    if (SUPPORTED.includes(json?.spec) && json?.data) return decoded
  } catch {
    // 忽略
  }
  return null
}

/** 从 PNG buffer 提取卡片 JSON；找不到 chara 关键字时兜底扫描 */
export function extractCharaJson(buffer: Buffer): string | null {
  try {
    const chunks = walkChunks(buffer)
    // 优先 chara 关键字
    for (const chunk of chunks) {
      const decoded = decodeTextChunk(chunk)
      if (decoded && decoded.keyword === CHARA_KEYWORD) {
        const card = parseCardJson(decoded.text)
        if (card) return card
      }
    }
    // 兜底：扫描所有文本 chunk，找能解析为 chara_card_v2 的
    for (const chunk of chunks) {
      const decoded = decodeTextChunk(chunk)
      if (!decoded || !decoded.text.trim()) continue
      const card = parseCardJson(decoded.text)
      if (card) return card
    }
  } catch (e) {
    console.error('[Png] extractCharaJson failed', e)
  }
  return null
}

/**
 * 忠实模拟 SillyTavern character-card-parser.js 的 `read`：
 *   1) 收集全部 tEXt chunk，按 \0 拆 keyword/text（keyword latin1）
 *   2) 优先 keyword==='ccv3'，其次 keyword==='chara'（均不区分大小写）
 *   3) 内容一律 Buffer.from(text,'base64').toString('utf8') 解码
 * 返回解码后的卡片 JSON 字符串；找不到返回 null。
 * 用于导出后的兼容性自检：ST 就是这样读 chara 的，若它解析不了，导入必报"文件已损坏"。
 */
export function stExtractCharaText(buffer: Buffer): string | null {
  try {
    const chunks = walkChunks(buffer)
    const textChunks: { keyword: string; text: string }[] = []
    for (const c of chunks) {
      if (c.type !== 'tEXt') continue
      const nul = c.data.indexOf(0)
      if (nul < 0) continue
      textChunks.push({
        keyword: c.data.subarray(0, nul).toString('latin1').toLowerCase(),
        text: c.data.subarray(nul + 1).toString('utf-8')
      })
    }
    if (textChunks.length === 0) return null
    const hit =
      textChunks.find((t) => t.keyword === 'ccv3') ??
      textChunks.find((t) => t.keyword === CHARA_KEYWORD)
    if (!hit) return null
    return Buffer.from(hit.text, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * 按 SillyTavern character-card-parser.js `write` 的格式构造要插入的 chunk：
 *   - chara：JSON base64 后写入（ST 读取时按 base64 解码，裸 JSON 会被解成乱码）
 *   - ccv3：同一 JSON 打上 spec='chara_card_v3' / spec_version='3.0' 后 base64 写入（ST 优先读它）
 * 顺序与 ST 一致：chara 在前、ccv3 在后、均位于 IEND 之前。
 */
function stWriteChunks(json: string): Buffer[] {
  const chara = chunkBytes(
    makeTextChunk(CHARA_KEYWORD, Buffer.from(json, 'utf-8').toString('base64'))
  )
  try {
    const v3 = JSON.parse(json) as Record<string, unknown>
    v3.spec = 'chara_card_v3'
    v3.spec_version = '3.0'
    const ccv3 = chunkBytes(
      makeTextChunk('ccv3', Buffer.from(JSON.stringify(v3), 'utf-8').toString('base64'))
    )
    return [chara, ccv3]
  } catch {
    // 与 ST 一致：v3 构造失败则只写 chara
    return [chara]
  }
}

/** 构造 tEXt chunk（UTF-8 内容） */
export function makeTextChunk(
  keyword: string,
  text: string
): { type: string; name: string; data: Buffer } {
  const keywordBuf = Buffer.from(keyword, 'latin1')
  const textBuf = Buffer.from(text, 'utf-8')
  return {
    type: 'tEXt',
    name: 'tEXt',
    data: Buffer.concat([keywordBuf, Buffer.from([0]), textBuf])
  }
}

/** PNG chunk CRC32（与 zlib CRC-32 一致） */
const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 把 {type,data} 编码为完整 chunk 字节：长度(4) + 类型(4) + data + CRC(4) */
function chunkBytes(chunk: { type: string; data: Buffer }): Buffer {
  const typeBuf = Buffer.from(chunk.type, 'latin1')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(chunk.data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, chunk.data])))
  return Buffer.concat([lenBuf, typeBuf, chunk.data, crcBuf])
}

/**
 * 替换 chara chunk。为兼容 SillyTavern 等**严格** PNG 解析器（校验 CRC/像素），
 * 这里不做"重解析+整文件重编码"（源 PNG 若有异常 chunk 会错位破坏 IDAT 像素），
 * 而是**原样字节拷贝**除 chara 外的所有 chunk，仅在 IEND 之前插入新 chara/ccv3（base64 编码、CRC 自算）。
 * 插入格式与 SillyTavern character-card-parser 的 write 完全一致（ST 读取时按 base64 解码，
 * 裸 JSON 会被 ST 解成乱码导致"文件已损坏"）。
 * 匹配逻辑与读取端 extractCharaJson 一致：
 *   - keyword 精确为 'chara' 的文本 chunk
 *   - 或任意能解析为卡片 JSON 的文本 chunk（兜底，兼容 keyword 非 'chara' 的导出工具）
 */
export function replaceCharaChunk(buffer: Buffer, newJson: string): Buffer {
  const chunks = walkChunks(buffer)
  const newCharaBytes = stWriteChunks(newJson)
  const parts: Buffer[] = [buffer.subarray(0, 8)] // PNG 签名原样
  let replaced = false
  for (const chunk of chunks) {
    if (chunk.type === 'IEND') {
      if (!replaced) {
        parts.push(...newCharaBytes)
        replaced = true
      }
      parts.push(buffer.subarray(chunk.start, chunk.end))
      continue
    }
    if (chunk.type === 'tEXt' || chunk.type === 'iTXt' || chunk.type === 'zTXt') {
      const decoded = decodeTextChunk(chunk)
      if (decoded && (decoded.keyword === CHARA_KEYWORD || parseCardJson(decoded.text))) {
        if (!replaced) {
          parts.push(...newCharaBytes)
          replaced = true
        }
        continue // 丢弃旧 chara 的原始字节
      }
    }
    parts.push(buffer.subarray(chunk.start, chunk.end))
  }
  if (!replaced) parts.push(...newCharaBytes)
  // 若 walkChunks 因异常提前停止，剩余字节原样保留，避免截断像素
  const lastEnd = chunks.length ? chunks[chunks.length - 1].end : 8
  if (lastEnd < buffer.length) parts.push(buffer.subarray(lastEnd))
  return Buffer.concat(parts)
}
