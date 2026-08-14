// M7 · 导出：PNG（保留头像）或 JSON
import { writeFile } from 'fs/promises'
import type { CardFormat, CharCardV2 } from '../../shared/types'
import { replaceCharaChunk } from '../png/chunks'

export async function exportCard(
  json: CharCardV2,
  format: CardFormat,
  outputPath: string,
  originalBuffer?: Buffer
): Promise<void> {
  const jsonText = JSON.stringify(json, null, 2)
  if (format === 'json') {
    await writeFile(outputPath, jsonText, 'utf-8')
    return
  }
  // PNG：必须有原像素
  if (!originalBuffer) {
    throw new Error('JSON 卡无原头像，无法导出 PNG（请使用 JSON 输出）。')
  }
  const newPng = replaceCharaChunk(originalBuffer, jsonText)
  await writeFile(outputPath, newPng)
}
