// M1 · 会话项目构建：读卡后组装 CardProject
import type {
  CardProject,
  HelperScript,
  Opening,
  RegexScript,
  WorldInfoEntry
} from '../shared/types'
import { createEmptyCanvas, zodToCanvas, extractSchemaExprFromScript } from '../shared/schema'
import { PLACEHOLDER_CREATE_CARD, PLACEHOLDER_STATUS } from '../shared/templates'
import type { ReadCardResult } from './card/reader'

function collectOpenings(result: ReadCardResult): Opening[] {
  const openings: Opening[] = []
  const { json } = result
  openings.push(extractOpening('main', json.data.first_mes))
  for (const [i, alt] of (json.data.alternate_greetings ?? []).entries()) {
    openings.push(extractOpening(`alt-${i}`, alt))
  }
  return openings
}

function extractOpening(key: string, text: string): Opening {
  const hasCreate = text.includes(PLACEHOLDER_CREATE_CARD)
  const hasStatus = text.includes(PLACEHOLDER_STATUS)
  const type: Opening['type'] = hasCreate
    ? hasStatus || text.length > 0
      ? 'mixed'
      : 'createCard'
    : 'text'
  // 提取 initvar override 块
  const regex = /---\n<UpdateVariable>\n<initvar>\n([\s\S]*?)\n<\/initvar>\n<\/UpdateVariable>/
  const m = text.match(regex)
  return { key, text, type, initvarOverride: m?.[1] }
}

function extractScripts(result: ReadCardResult): Record<string, HelperScript> {
  const scripts = result.json.data.extensions?.tavern_helper?.scripts ?? {}
  if (Array.isArray(scripts)) {
    // 酒馆助手新版把 scripts 存为数组（元素含 name）：归一化为 Record，方便面板按名管理
    const map: Record<string, HelperScript> = {}
    for (const s of scripts) {
      const name =
        typeof s?.name === 'string' && s.name ? s.name : `脚本${Object.keys(map).length + 1}`
      map[name] = { ...s, name }
    }
    return map
  }
  return scripts
}

function extractRegexes(result: ReadCardResult): RegexScript[] {
  return result.json.data.extensions?.regex_scripts ?? []
}

function extractWorldbook(result: ReadCardResult): WorldInfoEntry[] {
  // 兼容两种源格式：spec 数组，或部分工具写成的对象（Object.values 归一化）
  const entries = result.json.data.character_book?.entries ?? []
  return Object.values(entries).sort((a, b) => a.insertion_order - b.insertion_order)
}

/** 从 Zod 脚本提取 schema 源码（拆出 export const Schema = ...；key 大小写不敏感，如 'ZOD'） */
export function extractZodSchemaCode(scripts: Record<string, HelperScript>): string {
  const zod = Object.values(scripts).find((s) =>
    /registerMvuSchema|export\s+const\s+Schema/.test(s?.content ?? '')
  )
  if (!zod) return ''
  return extractSchemaExprFromScript(zod.content)
}

export async function buildProject(result: ReadCardResult): Promise<CardProject> {
  const scripts = extractScripts(result)
  const schemaCode = extractZodSchemaCode(scripts)
  let schemaCanvas = createEmptyCanvas()
  if (schemaCode) {
    try {
      schemaCanvas = zodToCanvas(schemaCode)
    } catch {
      // 反推失败：保留空画布（纯代码模式）
    }
  }
  return {
    card: { path: result.path, format: result.format, json: result.json },
    schemaCanvas,
    openings: collectOpenings(result),
    regexes: extractRegexes(result),
    worldbookEntries: extractWorldbook(result),
    scripts,
    mvuDetected: false // 由 IPC 层用 detectMvu 填充
  }
}
