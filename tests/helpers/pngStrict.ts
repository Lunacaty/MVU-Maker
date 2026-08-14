// PNG 严格校验辅助：模拟 SillyTavern 等严格解析器的检查（CRC 全部正确、IDAT 像素一致）

/** 校验 PNG 每个 chunk 的 CRC 是否正确 */
export function crc32Validate(buf: Buffer): boolean {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return false
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const typeStart = offset + 4
    if (typeStart + 4 > buf.length) return false
    const typeData = buf.subarray(typeStart, typeStart + 4 + length)
    if (typeStart + 4 + length + 4 > buf.length) return false
    const crcStored = buf.readUInt32BE(typeStart + 4 + length)
    const crcCalc = crc32(typeData)
    if (crcStored !== crcCalc) return false
    offset = typeStart + 4 + length + 4
    if (buf.toString('latin1', typeStart, typeStart + 4) === 'IEND') break
  }
  return true
}

/** 提取各文本 chunk 的 keyword，供断言 */
export function chunkKeywords(buf: Buffer): string[] {
  const out: string[] = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const nul = data.indexOf(0)
      if (nul >= 0) out.push(data.subarray(0, nul).toString('latin1'))
    }
    offset = offset + 8 + length + 4
    if (type === 'IEND') break
  }
  return out
}

/** 两个 PNG 的 IDAT（像素）字节是否完全一致 */
export function idatEquals(a: Buffer, b: Buffer): boolean {
  return Buffer.concat(collectIdat(a)).equals(Buffer.concat(collectIdat(b)))
}

function collectIdat(buf: Buffer): Buffer[] {
  const out: Buffer[] = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    if (type === 'IDAT') out.push(buf.subarray(offset + 8, offset + 8 + length))
    offset = offset + 8 + length + 4
    if (type === 'IEND') break
  }
  return out
}

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
