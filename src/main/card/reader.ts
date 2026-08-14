// M1 · CardReader：读卡 / 校验 / MVU 特征检测
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { isPng, extractCharaJson } from '../png/chunks'
import type { CardFormat, CharCardV2 } from '../../shared/types'

export class CardReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardReadError'
  }
}

export interface ReadCardResult {
  path: string
  format: CardFormat
  json: CharCardV2
  buffer: Buffer
}

export async function readCard(path: string): Promise<ReadCardResult> {
  let buffer: Buffer
  try {
    buffer = await readFile(path)
  } catch {
    throw new CardReadError('无法读取文件，请确认路径存在且可访问。')
  }

  const ext = extname(path).toLowerCase()
  let format: CardFormat
  let jsonText: string | null = null

  if (ext === '.png' || isPng(buffer)) {
    format = 'png'
    jsonText = extractCharaJson(buffer)
    if (jsonText === null) throw new CardReadError('PNG 中未找到 chara 文本块，不是有效的角色卡。')
  } else if (ext === '.json') {
    format = 'json'
    jsonText = buffer.toString('utf-8')
  } else {
    throw new CardReadError(`不支持的文件类型 "${ext}"，请选择 .png 或 .json 角色卡。`)
  }

  let json: CharCardV2
  try {
    json = JSON.parse(jsonText)
  } catch {
    throw new CardReadError('JSON 解析失败：文件内容损坏或非 UTF-8 编码。')
  }

  const SUPPORTED_SPECS = ['chara_card_v2', 'chara_card_v3']
  if (!SUPPORTED_SPECS.includes(json.spec) || !json.data) {
    throw new CardReadError(
      `不支持的卡片格式 "${json.spec}"（支持 ${SUPPORTED_SPECS.join(' / ')}）。`
    )
  }
  if (typeof json.data.name !== 'string' || typeof json.data.first_mes !== 'string') {
    throw new CardReadError('角色卡缺少必填字段 data.name / data.first_mes。')
  }

  return { path, format, json, buffer }
}

// MVU 特征检测：脚本含 MagVarUpdate + 存在禁用的 [InitVar] 条目
export function detectMvu(json: CharCardV2): boolean {
  const scripts = json.data.extensions?.tavern_helper?.scripts ?? {}
  const hasBundle = Object.values(scripts).some(
    (s) => s.type === 'script' && s.enabled && s.content.includes('MagVarUpdate')
  )
  const entries = json.data.character_book?.entries ?? []
  const hasInitVar = Object.values(entries).some(
    (e) => e.comment.includes('[InitVar]') && e.enabled === false
  )
  return hasBundle && hasInitVar
}
